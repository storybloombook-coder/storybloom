import { Component } from 'react';

/** Generic React error boundary (SPEC.md "Scene modes": "An ErrorBoundary
 *  wraps the 3D branch. A mount crash... -> switch to flat, call
 *  onSceneError"). Error boundaries MUST be class components -- there is no
 *  hooks equivalent for getDerivedStateFromError/componentDidCatch. Renders
 *  `fallback` (default: nothing) while caught, so the parent's own state
 *  update (triggered by `onError`) is what actually swaps the tree over to
 *  FlatMenu on the next render. */
export class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
