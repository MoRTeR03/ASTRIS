import { Component } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

export default class AstrisMapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, revision: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ASTRIS map boundary] Map runtime failed', error, info?.componentStack || '');
  }

  retry = () => {
    this.setState((state) => ({ error: null, revision: state.revision + 1 }));
  };

  render() {
    if (!this.state.error) {
      return <div key={this.state.revision} className="astris-map-boundary-host">{this.props.children}</div>;
    }
    const message = this.state.error?.message || String(this.state.error || 'Unknown map error');
    return (
      <section className="astris-map-runtime-error" role="alert">
        <div className="astris-map-runtime-error__icon"><AlertTriangle size={22} /></div>
        <div className="astris-map-runtime-error__copy">
          <span className="module-kicker">Map runtime isolation</span>
          <h2>Карта ASTRIS перезапущена захисним контуром</h2>
          <p>Інтерфейс не буде очищено через одиничний збій MapLibre/orbital renderer.</p>
          <code>{message}</code>
          <div className="astris-map-runtime-error__actions">
            <button type="button" onClick={this.retry}><RotateCcw size={14} />Повторити карту</button>
            <button type="button" onClick={() => window.location.reload()}><RefreshCw size={14} />Перезавантажити сторінку</button>
          </div>
        </div>
      </section>
    );
  }
}
