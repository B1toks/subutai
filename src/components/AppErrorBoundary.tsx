import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearMemoryStorage } from '../memory/storage';
import { buildErrorReport } from '../utils/errorReport';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
  confirmingReset: boolean;
  /** fix/v1.1.4 — what failed, for a bug report (see errorReport.ts). */
  details: string | null;
  copied: 'idle' | 'done' | 'failed';
}

/**
 * QA-07 — the last line between a render error and a blank page.
 *
 * Without it one bad value anywhere in the tree (a damaged Memory entry was
 * the one that actually happened) unmounted the whole app and left an empty
 * screen with no way out short of clearing site data by hand. The fallback
 * offers a reload and, behind a confirmation, wiping Memory's saved games,
 * which is the only local data known to be able to wedge the app.
 *
 * fix/v1.1.4 — the screen said nothing about what failed, so a report of
 * it could not be acted on. It now keeps the error, the first lines of its
 * stack and of the component stack, the version and the page address
 * (without query values or fragment) behind "Details", with a copy button.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, confirmingReset: false, details: null, copied: 'idle' };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[app] render failed', error, info.componentStack);
    this.setState({ details: this.report(error, info.componentStack) });
  }

  private report(error: unknown, componentStack?: string | null): string {
    return buildErrorReport({
      error,
      componentStack,
      version: __APP_VERSION__,
      href: window.location.href,
      userAgent: navigator.userAgent,
      at: new Date(),
    });
  }

  private reload = () => {
    window.location.reload();
  };

  private resetLocalData = () => {
    clearMemoryStorage();
    window.location.reload();
  };

  private copyDetails = async () => {
    const { details } = this.state;
    if (!details) return;
    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copied: 'done' });
    } catch {
      // No clipboard permission (or an old browser): select the text so a
      // long-press / Ctrl+C still gets it.
      const pre = document.getElementById('app-error-details-text');
      const sel = window.getSelection();
      if (pre && sel) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      this.setState({ copied: 'failed' });
    }
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { confirmingReset, details, copied } = this.state;
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
          {!confirmingReset && details && (
            <details className="app-error-details">
              <summary>Details</summary>
              <pre id="app-error-details-text" className="app-error-details-text">
                {details}
              </pre>
              <div className="app-error-details-actions">
                <button type="button" className="modal-btn modal-btn-secondary" onClick={this.copyDetails}>
                  Copy details
                </button>
                <span className="app-error-details-status" role="status">
                  {copied === 'done'
                    ? 'Copied'
                    : copied === 'failed'
                      ? 'Could not copy: the text is selected, copy it by hand'
                      : ''}
                </span>
              </div>
            </details>
          )}
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
