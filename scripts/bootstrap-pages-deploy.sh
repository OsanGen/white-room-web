#!/usr/bin/env bash

set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

echo "Bootstrapping GitHub Pages deploy for the current repository."

if ! command -v gh >/dev/null 2>&1; then
  echo "Missing dependency: gh (GitHub CLI). Install it with brew: brew install gh" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

ORIGIN_URL="$(git config --get remote.origin.url)"
if [[ "$ORIGIN_URL" =~ ^git@github\.com:([^/]+)/([^./]+)(\.git)?$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
elif [[ "$ORIGIN_URL" =~ ^https://github\.com/([^/]+)/([^./]+)(\.git)?$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
else
  echo "Unsupported origin URL: $ORIGIN_URL" >&2
  echo "Expected SSH or HTTPS GitHub origin."
  exit 1
fi

echo "Repository: ${OWNER}/${REPO}"

PAGES_JSON="$(gh api -X POST "repos/${OWNER}/${REPO}/pages" -F build_type=workflow)"
PAGES_URL="$(echo "${PAGES_JSON}" | awk -F'"' '/"html_url":/{print $4; exit}')"

if [[ -n "${PAGES_URL}" ]]; then
  echo "Pages enabled (or already enabled): ${PAGES_URL}"
else
  echo "Pages enabled but API response did not return html_url. Inspect result:"
  echo "${PAGES_JSON}"
fi

echo "Dispatching workflow: gh-pages.yml on branch ${BRANCH}"
gh workflow run "gh-pages.yml" --ref "${BRANCH}"
echo "Workflow dispatched. Wait a minute and open:"
if [[ -n "${PAGES_URL}" ]]; then
  echo "  ${PAGES_URL}"
else
  echo "  https://github.com/${OWNER}/${REPO}/deployments"
fi
