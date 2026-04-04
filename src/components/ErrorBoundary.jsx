import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '60px 20px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#f87171', marginBottom: 6 }}>
            Something went wrong
          </div>
          <div style={{
            fontSize: 12, color: '#6b7280', maxWidth: 400, marginBottom: 20,
            fontFamily: 'monospace', background: '#111827', padding: '8px 14px',
            borderRadius: 8, border: '1px solid #1f2937',
          }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '8px 20px', borderRadius: 8, border: '1px solid #374151',
              background: '#1f2937', color: '#d1d5db', cursor: 'pointer',
              fontWeight: 600, fontSize: 13,
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
