// supabase/functions/publish-site/github.ts
const OWNER = "AAArithrAAA108";
const REPO = "berserker-site";
const BRANCH = "main";

// GitHub's API occasionally returns a transient 503 ("no server currently
// available") under normal load -- observed twice in production on this
// function, on two different, unrelated blob-creation calls during a
// routine publish. A publish fires 40+ concurrent blob-creation requests
// (one per catalog page), so any single transient failure among them
// aborted the entire publish with no retry. Retrying a real 4xx (bad
// token, malformed body) would just delay a failure the caller needs to
// see, so only 5xx responses and network-level failures get retried, with
// a short exponential backoff (500ms, 1000ms) between attempts.
async function fetchWithRetry(input: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.status < 500 || attempt === maxAttempts) return res;
      lastErr = new Error(`transient ${res.status} ${res.statusText} from GitHub`);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  }
  throw lastErr;
}

// Parses a GitHub API response as JSON and throws a descriptive error
// (status + GitHub's own `.message`) if the request failed, instead of
// letting callers hit an opaque "Cannot read properties of undefined"
// TypeError when they reach into the (error-shaped) body afterwards.
async function parseGithubResponse(res: Response, label: string): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GitHub API error (${label}): ${res.status} ${res.statusText} — ${body?.message ?? "no message"}`);
  }
  return body;
}

export async function commitFiles(
  files: Record<string, string>,
  message: string,
  githubToken: string,
  deletePaths: string[] = []
): Promise<{ commitSha: string }> {
  const api = (path: string) =>
    fetchWithRetry(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
      },
    });

  const refRes = await api(`/git/ref/heads/${BRANCH}`);
  const ref = await parseGithubResponse(refRes, "get ref");
  const baseCommitSha = ref.object.sha;

  const commitRes = await fetchWithRetry(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits/${baseCommitSha}`, {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
  });
  const baseCommit = await parseGithubResponse(commitRes, "get base commit");
  const baseTreeSha = baseCommit.tree.sha;

  const treeEntries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blobRes = await fetchWithRetry(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ content, encoding: "utf-8" }),
      });
      const blob = await parseGithubResponse(blobRes, `create blob (${path})`);
      return { path, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  // A delete entry (sha: null) for a path absent from base_tree is not something
  // to trust GitHub to no-op gracefully -- fetch the actual base tree and only
  // emit delete entries for paths that really exist there. Skipped entirely when
  // there's nothing to delete, which is the common case on every normal publish.
  let deleteEntries: { path: string; mode: "100644"; type: "blob"; sha: null }[] = [];
  if (deletePaths.length > 0) {
    const baseTreeRes = await fetchWithRetry(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${baseTreeSha}?recursive=1`,
      { headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" } }
    );
    const baseTree = await parseGithubResponse(baseTreeRes, "get base tree");
    const existingPaths = new Set<string>((baseTree.tree ?? []).map((entry: { path: string }) => entry.path));
    deleteEntries = deletePaths
      .filter((path) => existingPaths.has(path))
      .map((path) => ({ path, mode: "100644" as const, type: "blob" as const, sha: null }));
  }

  const treeRes = await fetchWithRetry(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: [...treeEntries, ...deleteEntries] }),
  });
  const newTree = await parseGithubResponse(treeRes, "create tree");

  const newCommitRes = await fetchWithRetry(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseCommitSha] }),
  });
  const newCommit = await parseGithubResponse(newCommitRes, "create commit");

  const updateRefRes = await fetchWithRetry(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ sha: newCommit.sha }),
  });
  await parseGithubResponse(updateRefRes, "update ref");

  return { commitSha: newCommit.sha };
}
