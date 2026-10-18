// Free text from Sonar, Jira, and triage LLM output routinely contains literal
// HTML-looking snippets (e.g. "Use <input> or <textarea> instead of..."). Posted
// raw into a GitLab MR note/description, GitLab's markdown renderer treats those
// as real tags — <textarea> isn't self-closing, so an unclosed one can swallow
// the rest of the comment into a literal text box. Escape angle brackets so any
// free text we interpolate always renders as text.
function escapeMdHtml(text) {
  return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { escapeMdHtml };
