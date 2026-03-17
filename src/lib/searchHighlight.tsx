import React, { ReactNode } from 'react';

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recursively highlight query matches in React children.
 * Wraps matching text in <mark className="search-highlight">.
 */
export function highlightChildren(children: ReactNode, query: string): ReactNode {
    if (!query || query.length < 2) return children;

    const visit = (node: ReactNode): ReactNode => {
        if (node == null || typeof node === 'boolean') return node;
        if (typeof node === 'number') return node;

        if (typeof node === 'string') {
            const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
            const parts = node.split(regex);
            const qLower = query.toLowerCase();
            return parts.map((part, i) =>
                part.toLowerCase() === qLower ? (
                    <mark key={i} className="search-highlight">
                        {part}
                    </mark>
                ) : (
                    part
                )
            );
        }

        if (Array.isArray(node)) {
            return node.map((child, i) => (
                <React.Fragment key={i}>{visit(child)}</React.Fragment>
            ));
        }

        if (React.isValidElement(node) && node.props.children != null) {
            return React.cloneElement(node, {
                ...node.props,
                children: visit(node.props.children),
            } as Record<string, unknown>);
        }

        return node;
    };

    return visit(children);
}

/**
 * Highlight query in plain text. Returns React nodes.
 */
export function highlightText(text: string, query: string): ReactNode {
    if (!query || query.length < 2) return text;

    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="search-highlight">
                {part}
            </mark>
        ) : (
            part
        )
    );
}
