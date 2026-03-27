import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import "./index.css";

/**
 * Frontend application entry point.
 *
 * This file mounts the React app into the root DOM element, wraps the app with
 * the authentication provider, and enables React Strict Mode for additional
 * development-time checks.
 */
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
