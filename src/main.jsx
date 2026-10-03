import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Landing from './components/Landing.jsx'
import Privacy from './components/Privacy.jsx'

// Three pages, one bundle, no router dependency. The app has exactly three
// URLs and none of them nest, so a path switch is the whole requirement —
// react-router would be a dependency, a provider and a rendering model to
// buy one `if`. Unknown paths fall through to the app rather than to a 404
// page, because the only way to reach one is a stale link to a tab.
//
// vercel.json rewrites every path to index.html so these resolve on a hard
// load, not only on client navigation.
const path = window.location.pathname.replace(/\/+$/, "") || "/";

// A HOME-SCREEN LAUNCH ALWAYS OPENS THE APP, never the marketing page.
// manifest.webmanifest says start_url "/app", but that is not enough on its
// own: iOS only honours start_url from 16.4, and before that Add to Home
// Screen bookmarks whatever page you happened to be on — so an install made
// from the landing page launches to the landing page for ever. Any install
// created before this shipped is in exactly that state. Checking the display
// mode fixes those too, and costs one media query.
if (path === "/" && window.matchMedia("(display-mode: standalone)").matches) {
  window.location.replace("/app");
}
const Page = path === "/" ? Landing : path === "/privacy" ? Privacy : App;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
