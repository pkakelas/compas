// Entry for the live player app.
// Order matches the original script order; app-shell.jsx renders into #root
// when it evaluates (last import), after every dependency is on window.

// Self-hosted fonts (bundled by Vite, no CDN). Variable fonts cover every
// weight the UI uses; Newsreader is loaded italic-only to match its usage.
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/newsreader/wght-italic.css";

import "./globals.js";
import "./api.js";
import "./i18n.js";
import "../js/tweaks-panel.jsx";
import "../js/shared.jsx";
import "../js/chrome.jsx";
import "../js/app-player.jsx";
import "../js/tandas-data.jsx";
import "../js/tandas-tags.jsx";
import "../js/tandas-parts.jsx";
import "../js/tanda-name-suggest.jsx";
import "../js/smart-organize-view.jsx";
import "../js/import-tree.jsx";
import "../js/tandas-import.jsx";
import "../js/library-view.jsx";
import "../js/tandas-view.jsx";
import "../js/playlists-view.jsx";
import "../js/community-data.jsx";
import "../js/community-share.jsx";
import "../js/community-feed.jsx";
import "../js/community-view.jsx";
import "../js/settings-view.jsx";
import "../js/onboarding.jsx";
import "../js/app-shell.jsx";
