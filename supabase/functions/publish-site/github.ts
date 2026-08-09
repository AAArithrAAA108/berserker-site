// supabase/functions/publish-site/github.ts
const OWNER = "AAArithrAAA108";
const REPO = "berserker-site";
const BRANCH = "main";

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
  const ref = await refRes.json();
  const baseCommitSha = ref.object.sha;

  const commitRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits/${baseCommitSha}`, {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
  });
  const baseCommit = await commitRes.json();
  const baseTreeSha = baseCommit.tree.sha;

  const treeEntries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blobRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ content, encoding: "utf-8" }),
      });
      const blob = await blobRes.json();
      return { path, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  const treeRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  const newTree = await treeRes.json();

  const newCommitRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseCommitSha] }),
  });
  const newCommit = await newCommitRes.json();

  await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return { commitSha: newCommit.sha };
}
