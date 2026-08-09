// supabase/functions/publish-site/github.ts
const OWNER = "AAArithrAAA108";
const REPO = "berserker-site";
const BRANCH = "main";

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
  githubToken: string
): Promise<{ commitSha: string }> {
  const api = (path: string) =>
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
      },
    });

  const refRes = await api(`/git/ref/heads/${BRANCH}`);
  const ref = await parseGithubResponse(refRes, "get ref");
  const baseCommitSha = ref.object.sha;

  const commitRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits/${baseCommitSha}`, {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
  });
  const baseCommit = await parseGithubResponse(commitRes, "get base commit");
  const baseTreeSha = baseCommit.tree.sha;

  const treeEntries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blobRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ content, encoding: "utf-8" }),
      });
      const blob = await parseGithubResponse(blobRes, `create blob (${path})`);
      return { path, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  const treeRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  const newTree = await parseGithubResponse(treeRes, "create tree");

  const newCommitRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseCommitSha] }),
  });
  const newCommit = await parseGithubResponse(newCommitRes, "create commit");

  const updateRefRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ sha: newCommit.sha }),
  });
  await parseGithubResponse(updateRefRes, "update ref");

  return { commitSha: newCommit.sha };
}
