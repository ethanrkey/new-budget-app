import { Component } from "react";

// ONE COMPONENT THAT THROWS MUST NEVER BLANK THE WHOLE APP.
//
// It did, in production, 2026-10-26 to 10-28: clicking an existing
// one-off threw during EventForm's render, and with nothing to catch it
// React unmounted everything and left a black page. The bug was one
// `.trim()`; the black page was the absence of this.
//
// React only catches render errors in a class component, so this is the
// one class in the app. Two shapes:
//   <ErrorBoundary onClose={...}>  — around a modal or form. The fallback
//     is a small dialog that says so and closes, and the app behind it is
//     untouched.
//   <ErrorBoundary>                — around the root. Nothing behind it to
//     return to, so the fallback offers a reload.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { onClose } = this.props;
    if (onClose) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-label="Something went wrong">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-900 p-5 text-sm text-gray-700 dark:text-gray-300 shadow-xl">
            <p className="font-medium text-gray-900 dark:text-gray-100">Something went wrong opening this.</p>
            <p className="mt-2">Nothing was saved or changed. Close it and the rest of the app is as you left it.</p>
            <button
              onClick={() => { this.setState({ error: null }); onClose(); }}
              className="mt-4 w-full py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
            >
              Close
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-700 dark:bg-gray-950 dark:text-gray-300 p-6" role="alert">
        <div className="max-w-sm text-center text-sm">
          <p className="font-medium text-gray-900 dark:text-gray-100">Something went wrong.</p>
          <p className="mt-2">Your data is safe on the server. Reloading usually fixes this.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
