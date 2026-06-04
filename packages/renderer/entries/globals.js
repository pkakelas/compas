// The design files were authored as classic scripts that read `React` /
// `ReactDOM` off the global scope and publish their components onto `window`.
// We preserve that contract by exposing the bundled React on the global object
// before any design module evaluates. Because every design file attaches its
// public symbols to `window`, cross-file references resolve at render time.
import React from "react";
import { createRoot } from "react-dom/client";

window.React = React;
window.ReactDOM = { createRoot };
