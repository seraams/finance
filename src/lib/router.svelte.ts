/**
 * Minimaler Hash-Router (`#/pfad?x=y`). Ein Neuladen auf GitHub Pages
 * liefert so nie eine 404-Seite.
 */
export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [p = '/', q = ''] = raw.split('?');
  const path = p.startsWith('/') ? p : `/${p}`;
  return {
    path,
    segments: path.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(q),
  };
}

class Router {
  route = $state<Route>(parse(typeof location !== 'undefined' ? location.hash : ''));

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        this.route = parse(location.hash);
      });
    }
  }

  go(path: string, opts: { replace?: boolean } = {}): void {
    const hash = `#${path}`;
    if (opts.replace) {
      history.replaceState(null, '', hash);
      this.route = parse(hash);
    } else {
      location.hash = path;
    }
  }

  back(fallback = '/'): void {
    if (history.length > 1) history.back();
    else this.go(fallback, { replace: true });
  }
}

export const router = new Router();

export function href(path: string): string {
  return `#${path}`;
}
