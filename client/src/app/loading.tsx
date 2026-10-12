// Streaming fallback for `page.tsx`. Without this, Next has nothing to send until every server
// fetch on the page has resolved, so a phone on a cold start sits on a blank white document for
// as long as the slowest query takes. With it, the chrome is in the first flush — the browser
// starts on the stylesheet and fonts straight away and the real UI swaps in underneath.
export { default } from "@/components/taskbook/AppFrame";
