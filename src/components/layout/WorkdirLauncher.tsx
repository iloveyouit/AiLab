/**
 * WorkdirLauncher - Dropdown popover in the NavBar that lists recent working
 * directories. Clicking a directory instantly launches a terminal session
 * in that directory using saved connection config from localStorage.
 *
 * The dropdown uses position:fixed and measures the trigger button rect so
 * it never clips outside the viewport regardless of where the button sits.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { showToast } from '@/components/ui/ToastContainer';
import { useSessionStore } from '@/stores/sessionStore';
import { useKnownProjects } from '@/hooks/useKnownProjects';
import styles from '@/styles/modules/WorkdirLauncher.module.css';

const WORKDIR_HISTORY_KEY = 'workdir-history';
const LAST_SESSION_KEY = 'lastSession';

interface LastSessionConfig {
  host?: string;
  port?: number;
  username?: string;
  authMethod?: 'key' | 'password';
  privateKeyPath?: string;
  command?: string;
}

function loadWorkdirHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WORKDIR_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveWorkdirHistory(dirs: string[]): void {
  localStorage.setItem(WORKDIR_HISTORY_KEY, JSON.stringify(dirs));
}

function loadLastSession(): LastSessionConfig {
  try {
    return JSON.parse(localStorage.getItem(LAST_SESSION_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Extract the last meaningful segment from a path for display. */
function shortenPath(fullPath: string): string {
  const normalized = fullPath.replace(/\/+$/, '');
  if (normalized === '~' || normalized === '/') return normalized;
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

/** Viewport-safe dropdown width in pixels */
const DROPDOWN_WIDTH = 360;
const DROPDOWN_GAP = 6;
const VIEWPORT_PADDING = 16;

export default function WorkdirLauncher() {
  const [open, setOpen] = useState(false);
  const [dirs, setDirs] = useState<string[]>([]);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const knownProjects = useKnownProjects();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useClickOutside(wrapperRef, close, open);

  // Calculate dropdown position whenever it opens
  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const top = rect.bottom + DROPDOWN_GAP;

    // Try to align left edge with button; clamp so it doesn't overflow right
    let left = rect.left;
    const maxLeft = window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_PADDING;
    if (left > maxLeft) left = maxLeft;
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;

    setDropdownPos({ top, left });
  }, []);

  // Reload history merged with known projects each time the dropdown opens
  useEffect(() => {
    if (open) {
      updatePosition();
      const history = loadWorkdirHistory();
      const seen = new Set(history);
      const merged = [...history];
      for (const dir of knownProjects) {
        if (!seen.has(dir)) {
          seen.add(dir);
          merged.push(dir);
        }
      }
      setDirs(merged);
    }
  }, [open, knownProjects, updatePosition]);

  // Escape key closes dropdown
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, close]);

  // Re-position on scroll/resize so it stays anchored
  useEffect(() => {
    if (!open) return;
    const reposition = () => updatePosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, updatePosition]);

  async function handleLaunch(workingDir: string) {
    close();

    const saved = loadLastSession();

    try {
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: saved.host || window.location.hostname || 'localhost',
          port: saved.port || undefined,
          username: saved.username || undefined,
          authMethod: saved.authMethod || undefined,
          privateKeyPath: saved.privateKeyPath || undefined,
          workingDir,
          command: saved.command || 'claude',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        // Auto-select the new session so the detail panel stays open
        if (data.terminalId) {
          useSessionStore.getState().selectSession(data.terminalId);
        }
        showToast(`Session launched in ${shortenPath(workingDir)}`, 'success');
      } else {
        showToast(data.error || 'Failed to launch session', 'error');
      }
    } catch {
      showToast('Network error launching session', 'error');
    }
  }

  function handleRemove(dir: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = dirs.filter((d) => d !== dir);
    setDirs(updated);
    saveWorkdirHistory(updated);
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        ref={btnRef}
        className={`${styles.triggerBtn} ${open ? styles.open : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        title="Recent working directories"
      >
        DIRS
      </button>

      {open && (
        <div
          className={styles.dropdown}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: DROPDOWN_WIDTH,
          }}
        >
          <div className={styles.dropdownHeader}>Recent Directories</div>
          {dirs.length === 0 ? (
            <div className={styles.empty}>
              No directory history yet. Launch a session to start recording.
            </div>
          ) : (
            dirs.map((dir) => (
              <div
                key={dir}
                className={styles.dirItem}
                onClick={() => handleLaunch(dir)}
                title={`Launch session in ${dir}`}
              >
                <div className={styles.dirInfo}>
                  <span className={styles.dirName}>{shortenPath(dir)}</span>
                  <span className={styles.dirPath}>{dir}</span>
                </div>
                <button
                  className={styles.dirRemove}
                  onClick={(e) => handleRemove(dir, e)}
                  title="Remove from history"
                >
                  x
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
