import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TreeNode } from '../lib/taxonomy';
import styles from './TaxonomyTreeDiagram.module.css';

// Node-link diagram of a taxonomy subtree, rooted at the selected node. Circle *area* encodes the
// number of distinct datasets under each node (relative to the root). Unlike a treemap or sunburst,
// nothing here implies that children sum to their parent — which they don't, since one dataset can
// cover several crops.
//
// Interaction: click a circle to expand/collapse it in place; click a name to open that node
// (re-roots the diagram and updates the rest of the page).

const COLUMN_WIDTH = 210;
const ROW_HEIGHT = 26;
const MAX_RADIUS = 15;
const MIN_RADIUS = 3.5;
const CHILD_LIMIT = 10;
const LABEL_MAX = 26;
const PADDING = { top: 30, right: 16, bottom: 14, left: 20 };

interface LaidOut {
  key: string;
  node: TreeNode | null; // null for a "+N more" placeholder
  parentKey: string | null;
  hiddenCount: number; // for placeholders
  x: number;
  y: number;
  r: number;
  expandable: boolean;
  expanded: boolean;
}

function truncate(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

export function TaxonomyTreeDiagram({ root, onSelect }: { root: TreeNode; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root.id]));
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<{ item: LaidOut; left: number; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(new Set([root.id]));
    setShowAll(new Set());
    setHover(null);
  }, [root.id]);

  const { items, width, height } = useMemo(() => {
    const out: LaidOut[] = [];
    const rootCount = Math.max(1, root.datasets.size);
    const radius = (count: number) => MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(count / rootCount);
    let nextRow = 0;
    let maxDepth = 0;

    // Leaves take the next row; a parent sits midway between its first and last visible child.
    const place = (node: TreeNode, depth: number, parentKey: string | null): LaidOut => {
      maxDepth = Math.max(maxDepth, depth);
      const isOpen = expanded.has(node.id) && node.children.length > 0;
      const item: LaidOut = {
        key: node.id || '__root',
        node,
        parentKey,
        hiddenCount: 0,
        x: depth * COLUMN_WIDTH,
        y: 0,
        r: radius(node.datasets.size),
        expandable: node.children.length > 0,
        expanded: isOpen,
      };
      out.push(item);
      if (!isOpen) {
        item.y = nextRow++ * ROW_HEIGHT;
        return item;
      }
      // Don't hide just one or two children behind a "+N more" stub.
      const limit = showAll.has(node.id) || node.children.length <= CHILD_LIMIT + 2 ? node.children.length : CHILD_LIMIT;
      const placed = node.children.slice(0, limit).map((child) => place(child, depth + 1, item.key));
      const hidden = node.children.length - limit;
      if (hidden > 0) {
        const more: LaidOut = {
          key: `${item.key}#more`,
          node: null,
          parentKey: item.key,
          hiddenCount: hidden,
          x: (depth + 1) * COLUMN_WIDTH,
          y: nextRow++ * ROW_HEIGHT,
          r: MIN_RADIUS,
          expandable: false,
          expanded: false,
        };
        out.push(more);
        placed.push(more);
      }
      item.y = (placed[0].y + placed[placed.length - 1].y) / 2;
      return item;
    };
    place(root, 0, null);

    for (const item of out) {
      item.x += PADDING.left + MAX_RADIUS;
      item.y += PADDING.top;
    }
    return {
      items: out,
      width: PADDING.left + MAX_RADIUS + maxDepth * COLUMN_WIDTH + COLUMN_WIDTH + PADDING.right,
      height: PADDING.top + Math.max(1, nextRow) * ROW_HEIGHT + PADDING.bottom,
    };
  }, [root, expanded, showAll]);

  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);

  const toggle = (item: LaidOut) => {
    if (!item.node || !item.expandable) return;
    const id = item.node.id;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activate = (item: LaidOut) => {
    if (item.node) onSelect(item.node.id);
    else if (item.parentKey) {
      const parent = byKey.get(item.parentKey);
      if (parent?.node) setShowAll((prev) => new Set([...prev, parent.node!.id]));
    }
  };

  const onKey = (event: KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };

  const showHover = (item: LaidOut) => {
    if (!item.node) return;
    setHover({ item, left: item.x + item.r + 8, top: item.y + 14 });
  };

  return (
    <div className={styles.wrapper}>
      <p className={styles.hint}>
        Circle size = number of datasets. Click a <strong>circle</strong> to expand it, or a <strong>name</strong> to open it.
      </p>
      <div className={styles.scroller} ref={containerRef} onMouseLeave={() => setHover(null)}>
        <svg
          className={styles.svg}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="tree"
          aria-label={`${root.label} taxonomy diagram`}
        >
          <g>
            {items.map((item) => {
              if (!item.parentKey) return null;
              const parent = byKey.get(item.parentKey)!;
              const x0 = parent.x + parent.r;
              const x1 = item.x - item.r;
              const mid = (x0 + x1) / 2;
              return (
                <path
                  key={`link-${item.key}`}
                  className={styles.link}
                  d={`M${x0},${parent.y} C${mid},${parent.y} ${mid},${item.y} ${x1},${item.y}`}
                />
              );
            })}
          </g>
          {items.map((item) => {
            const isRoot = item.parentKey == null;
            // Open parents label above their circle (their right side carries links); everything
            // else labels to the right.
            const labelAbove = item.expanded;
            const labelX = labelAbove ? item.x : item.x + item.r + 6;
            const labelY = labelAbove ? item.y - item.r - 6 : item.y;
            const label = item.node ? truncate(item.node.label) : `+${item.hiddenCount} more`;
            const nodeClass = !item.node
              ? styles.nodeMore
              : item.expandable && !item.expanded
                ? styles.nodeCollapsed
                : item.expanded
                  ? styles.nodeOpen
                  : styles.nodeLeaf;
            return (
              <g key={item.key} onMouseEnter={() => showHover(item)}>
                <circle
                  className={`${styles.node} ${nodeClass} ${item.expandable ? styles.clickable : ''}`}
                  cx={item.x}
                  cy={item.y}
                  r={item.r}
                  role={item.expandable ? 'button' : undefined}
                  tabIndex={item.expandable ? 0 : undefined}
                  aria-expanded={item.expandable ? item.expanded : undefined}
                  aria-label={item.node && item.expandable ? `${item.expanded ? 'Collapse' : 'Expand'} ${item.node.label}` : undefined}
                  onClick={() => (item.node ? toggle(item) : activate(item))}
                  onKeyDown={(event) => onKey(event, () => toggle(item))}
                />
                {/* Generous invisible hit target around small circles. */}
                {item.expandable && item.r < 9 && (
                  <circle className={styles.hit} cx={item.x} cy={item.y} r={10} onClick={() => toggle(item)} aria-hidden="true" />
                )}
                <text
                  className={`${styles.label} ${isRoot ? styles.labelRoot : ''} ${!item.node ? styles.labelMore : ''}`}
                  x={labelX}
                  y={labelY}
                  textAnchor={labelAbove ? 'middle' : 'start'}
                  dominantBaseline={labelAbove ? 'auto' : 'central'}
                  role="link"
                  tabIndex={0}
                  onClick={() => activate(item)}
                  onKeyDown={(event) => onKey(event, () => activate(item))}
                >
                  {label}
                  {item.node && !isRoot && <tspan className={styles.count}> {item.node.datasets.size}</tspan>}
                </text>
              </g>
            );
          })}
        </svg>
        {hover?.item.node && (
          <div className={styles.tooltip} style={{ left: hover.left, top: hover.top }} role="status">
            <strong>{hover.item.node.label}</strong>
            {hover.item.node.scientific && <em> {hover.item.node.scientific}</em>}
            <span className={styles.tooltipMeta}>
              {hover.item.node.level} · {hover.item.node.datasets.size.toLocaleString()}{' '}
              {hover.item.node.datasets.size === 1 ? 'dataset' : 'datasets'}
              {hover.item.expandable && ` · ${hover.item.node.children.length} ${hover.item.node.childLevel?.toLowerCase() ?? 'children'}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default TaxonomyTreeDiagram;
