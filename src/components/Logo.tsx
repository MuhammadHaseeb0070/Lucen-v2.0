import React from 'react';

interface LogoProps {
    /** Target width in pixels; height scales with the SVG viewBox */
    size?: number;
    className?: string;
}

const Logo: React.FC<LogoProps> = ({ size = 24, className }) => {
    const style: React.CSSProperties = {
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
    };

    return (
        <span className={className} style={style} aria-hidden="true">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                preserveAspectRatio="xMidYMid meet"
            >
                <rect
                    x="2.5"
                    y="2.5"
                    width="19"
                    height="19"
                    rx="5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    opacity="0.28"
                />
                <path
                    d="M8.3 6.2c0-.66.54-1.2 1.2-1.2h.08c.66 0 1.2.54 1.2 1.2v9.1h7.02c.66 0 1.2.54 1.2 1.2v.08c0 .66-.54 1.2-1.2 1.2H9.5c-.66 0-1.2-.54-1.2-1.2V6.2z"
                    fill="currentColor"
                />
                <circle cx="15.9" cy="8.1" r="1.2" fill="currentColor" opacity="0.85" />
            </svg>
        </span>
    );
};

export default Logo;

