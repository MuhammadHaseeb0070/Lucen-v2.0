import React, { Component, forwardRef } from 'react';
import type { ReactNode } from 'react';
import { ReactLenis } from 'lenis/react';

interface Props {
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
    /** Whether to disable smooth scrolling entirely on this instance */
    disabled?: boolean;
}

interface State {
    hasError: boolean;
}

/**
 * Error boundary ensures that if Lenis fails to load or crashes 
 * (e.g. unsupported environment), we fallback gracefully to native scrolling 
 * instead of breaking the app.
 */
class SmoothScrollErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(_: Error): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('Lenis Smooth Scroll Error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError || this.props.disabled) {
            // Fallback to normal native scrolling container without Lenis
            return (
                <div className={this.props.className} style={this.props.style}>
                    {this.props.children}
                </div>
            );
        }
        return this.props.children;
    }
}

export const SmoothScroll = forwardRef<HTMLDivElement, Props>(
    ({ children, className, style, disabled }, ref) => {
        return (
            <SmoothScrollErrorBoundary className={className} style={style} disabled={disabled}>
                <ReactLenis className={className} style={style} ref={ref} options={{ autoRaf: true, syncTouch: true }}>
                    {children}
                </ReactLenis>
            </SmoothScrollErrorBoundary>
        );
    }
);

SmoothScroll.displayName = 'SmoothScroll';
