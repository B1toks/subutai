import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearMemoryStorage } from '../memory/storage';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
  confirmingReset: boolean;
}

/**
 * QA-07 — the last line between a render error and a blank page.
 *
 * Without it one bad value anywhere in the tree (a damaged Memory entry was
 * the one that actually happened) unmounted the whole app and left an empty
 * screen with no way out short of clearing site data by hand. The fallback
 * offers a reload and, behind a confirmation, wiping Memory's saved games,
 * which is the only local data known to be able to wedge the app.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, confirmingReset: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[app] render failed', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private resetLocalData = () => {
    clearMemoryStorage();
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { confirmingReset } = this.state;
    return (
      <div className="modal-backdrop">
        <div className="modal-dialog" role="alertdialog" aria-modal="true" aria-labelledby="app-error-title">
          <h2 className="modal-title" id="app-error-title">
            {confirmingReset ? 'Reset local data?' : 'Something went wrong'}
          </h2>
          <p className="modal-subtitle">
            {confirmingReset
              ? 'This deletes the games saved in Memory on this device. Your settings, your name and your online stats are kept.'
              : 'Reloading usually fixes this. If it keeps happening, a game saved in Memory may be damaged, and resetting local data clears it.'}
          </p>
          <div className="modal-actions">
            {confirmingReset ? (
              <>
                <button
                  type="button"
                  className="modal-btn modal-btn-secondary"
                  onClick={() => this.setState({ confirmingReset: false })}
                >
                  Cancel
                </button>
                <button type="button" className="modal-btn modal-btn-danger" onClick={this.resetLocalData}>
                  Delete saved games
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="modal-btn modal-btn-secondary"
                  onClick={() => this.setState({ confirmingReset: true })}
                >
                  Reset local data
                </button>
                <button type="button" className="modal-btn modal-btn-primary" onClick={this.reload}>
                  Reload
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}
