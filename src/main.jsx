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
const Page = path === "/" ? Landing : path === "/privacy" ? Privacy : App;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
