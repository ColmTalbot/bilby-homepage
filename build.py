#!/usr/bin/env python
"""Build the bilby homepage.

    python build.py                 # build the theme named in content/site.yaml into _site/
    python build.py --all           # also build every theme under _site/preview/<theme>/
    python build.py --offline       # don't fetch PyPI/GitHub/DOI data (use the cache)
    python build.py serve           # build --all, serve on http://localhost:8000, rebuild on change
    python build.py new "Title"     # start a new announcement in content/announcements/

Content lives in content/; presentation in themes/<name>/ (index.html +
style.css) and themes/_shared/ (macros used by every theme); assets shared by
all themes live in static/.
"""

import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import markdown
import yaml
from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
THEMES = ROOT / "themes"
STATIC = ROOT / "static"
OUT = ROOT / "_site"
CACHE = ROOT / ".cache" / "live.json"
TODAY = dt.date.today()


# ---------------------------------------------------------------- live data
# Everything fetched from the network is cached, so a build without network
# access (or with a rate-limited GitHub API) uses the last good values.


def fetch_json(url, accept="application/json"):
    headers = {"Accept": accept, "User-Agent": "bilby-homepage-build"}
    if url.startswith("https://api.github.com/") and os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"  # higher rate limit in CI
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=15) as response:
        body = response.read().decode()
    return body if accept != "application/json" else json.loads(body)


def load_live(site, offline):
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    if offline:
        return cache
    auto = site["automation"]
    live = dict(cache)
    try:
        info = fetch_json(f"https://pypi.org/pypi/{auto['pypi_package']}/json")
        version = info["info"]["version"]
        uploaded = info["releases"][version][0]["upload_time"][:10]
        live["release"] = {"version": version, "date": uploaded}
    except Exception as error:  # noqa: BLE001 - any failure means "use the cache"
        print(f"warning: could not fetch PyPI data ({error}); using cache", file=sys.stderr)
    releases = auto.get("release_announcements")
    if releases:
        try:
            data = fetch_json(f"https://api.github.com/repos/{releases['repo']}/releases?per_page={releases['count']}")
            live["releases"] = [
                {"tag": r["tag_name"], "name": r["name"] or r["tag_name"], "date": r["published_at"][:10],
                 "url": r["html_url"], "body": r["body"] or ""}
                for r in data if not r["draft"] and not r["prerelease"]
            ]
        except Exception as error:  # noqa: BLE001
            print(f"warning: could not fetch GitHub releases ({error}); using cache", file=sys.stderr)
    bibtex = live.setdefault("bibtex", {})
    for paper in site["citation"]["papers"]:
        doi = paper["href"].split("doi.org/")[-1]
        if doi in bibtex:
            continue
        try:
            bibtex[doi] = fetch_json(f"https://doi.org/{doi}", accept="application/x-bibtex").strip()
        except Exception as error:  # noqa: BLE001
            print(f"warning: could not fetch BibTeX for {doi} ({error})", file=sys.stderr)
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(live, indent=1))
    return live


# ------------------------------------------------------------ announcements

FRONT_MATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)


def as_date(value):
    if value in (None, ""):
        return None
    return value if isinstance(value, dt.date) else dt.date.fromisoformat(str(value))


def load_announcements(site, live):
    items = []
    for path in sorted((CONTENT / "announcements").glob("*.md")):
        match = FRONT_MATTER.match(path.read_text())
        if not match:
            raise SystemExit(f"{path}: an announcement needs YAML front matter between --- lines")
        meta, body = yaml.safe_load(match.group(1)), match.group(2).strip()
        meta["date"] = as_date(meta.get("date")) or as_date(path.name[:10])
        meta["expires"] = as_date(meta.get("expires"))
        if meta.get("draft") or (meta["expires"] and meta["expires"] < TODAY) or meta["date"] > TODAY:
            continue
        meta["html"] = markdown.markdown(body)
        meta["summary"] = meta.get("summary") or summarise(body)
        meta["slug"] = path.stem
        items.append(meta)

    auto = site["automation"].get("release_announcements")
    if auto:
        known = {item.get("release") for item in items}
        for release in live.get("releases", []):
            date = as_date(release["date"])
            if release["tag"] in known or (TODAY - date).days > auto.get("max_age_days", 365):
                continue
            version = release["tag"].lstrip("v")
            body = (f"bilby {version} is out. Upgrade with `pip install -U bilby` or from conda-forge. "
                    f"[Read the release notes]({release['url']}).")
            items.append({
                "title": f"bilby {version} released", "date": date, "link": release["url"],
                "tag": "Release", "html": markdown.markdown(body), "summary": summarise(body),
                "slug": f"release-{version}", "release": release["tag"],
            })

    for item in items:
        for key in ("link", "tag", "pinned", "expires", "release"):
            item.setdefault(key, None)
    items.sort(key=lambda item: (bool(item["pinned"]), item["date"]), reverse=True)
    return items[: site["automation"].get("max_announcements", 5)]


def summarise(text, length=180):
    plain = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    plain = re.sub(r"[`*_#>]", "", plain).split("\n\n")[0].strip()
    return plain if len(plain) <= length else plain[: length - 1].rsplit(" ", 1)[0] + "…"


def format_bibtex(entry):
    """doi.org returns an entry on one line; put each field on its own line."""
    if not entry:
        return None
    entry = re.sub(r",\s*(\w+)=", r",\n  \1 = ", re.sub(r"\s+", " ", entry.strip()))
    entry = re.sub(r"^(@\w+\{[^,]+),\s*", r"\1,\n  ", entry)
    return re.sub(r"\}\s*\}$", "}\n}", entry)


def atom_feed(site, announcements):
    updated = max((a["date"] for a in announcements), default=TODAY)
    entries = []
    for item in announcements:
        when = dt.datetime.combine(item["date"], dt.time(12), dt.timezone.utc)
        link = item.get("link") or f"{site['url']}/#news-{item['slug']}"
        entries.append(f"""  <entry>
    <title>{html.escape(item['title'])}</title>
    <id>{html.escape(link)}</id>
    <link href="{html.escape(link)}"/>
    <updated>{when.isoformat()}</updated>
    <content type="html">{html.escape(item['html'])}</content>
  </entry>""")
    return f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>bilby news</title>
  <id>{site['url']}/</id>
  <link href="{site['url']}/"/>
  <link rel="self" href="{site['url']}/feed.xml"/>
  <updated>{dt.datetime.combine(updated, dt.time(12), dt.timezone.utc).isoformat()}</updated>
{chr(10).join(entries)}
</feed>
"""


# -------------------------------------------------------------------- build


def load_context(offline):
    site = yaml.safe_load((CONTENT / "site.yaml").read_text())
    live = load_live(site, offline)
    release = live.get("release") or {"version": site["automation"]["fallback_version"], "date": None}
    announcements = load_announcements(site, live)
    examples = [
        {"name": ex["name"], "code": (ROOT / ex["file"]).read_text().strip() + "\n"}
        for ex in site["try_examples"]
    ]
    for paper in site["citation"]["papers"]:
        paper["bibtex"] = format_bibtex(live.get("bibtex", {}).get(paper["href"].split("doi.org/")[-1]))
    return {
        "site": site, "release": release, "examples": examples,
        "announcements": announcements,
        "pinned": next((a for a in announcements if a.get("pinned")), None),
        "build_date": TODAY,
        "build_stamp": dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M"),
    }


def render_theme(theme, context, dest, previews=(), preview_base="../"):
    """Render one theme into dest. `preview_base` is the path from this page
    to the preview index (the switcher's links), when `previews` are listed."""
    env = Environment(
        loader=FileSystemLoader([THEMES / theme, THEMES / "_shared"]),
        autoescape=True, trim_blocks=True, lstrip_blocks=True,
    )
    env.filters["date"] = lambda d, fmt="%-d %b %Y": d.strftime(fmt) if d else ""
    env.filters["tojson_script"] = lambda v: json.dumps(v).replace("</", "<\\/")
    env.filters["groupby_ordered"] = groupby_ordered
    dest.mkdir(parents=True, exist_ok=True)
    page_context = dict(context, theme=theme, previews=previews, preview_base=preview_base)
    (dest / "index.html").write_text(env.get_template("index.html").render(page_context))
    shutil.copytree(STATIC, dest / "static", dirs_exist_ok=True)
    for asset in (THEMES / theme).iterdir():
        if asset.name != "index.html":
            shutil.copy2(asset, dest / "static" / f"theme-{asset.name}")
    (dest / "feed.xml").write_text(atom_feed(context["site"], context["announcements"]))
    (dest / "announcements.json").write_text(json.dumps(
        [{k: str(v) if isinstance(v, dt.date) else v for k, v in a.items()} for a in context["announcements"]],
        indent=1))


def groupby_ordered(items, key):
    """Like Jinja's groupby, but groups keep the order they first appear in."""
    groups = {}
    for item in items:
        groups.setdefault(item[key], []).append(item)
    return [{"grouper": k, "list": v} for k, v in groups.items()]


def available_themes():
    return sorted(p.name for p in THEMES.iterdir() if p.is_dir() and not p.name.startswith("_"))


def build(all_themes=False, offline=False):
    context = load_context(offline)
    if OUT.exists():
        shutil.rmtree(OUT)
    themes = available_themes()
    previews = themes if all_themes else ()
    render_theme(context["site"]["theme"], context, OUT, previews, preview_base="preview/")
    (OUT / ".nojekyll").touch()
    if all_themes:
        for theme in themes:
            render_theme(theme, context, OUT / "preview" / theme, previews)
        (OUT / "preview" / "index.html").write_text(preview_index(themes, context["site"]["theme"]))
    print(f"built {'all themes' if all_themes else context['site']['theme']} into {OUT.relative_to(ROOT)}/ "
          f"(bilby {context['release']['version']}, {len(context['announcements'])} announcements)")


def preview_index(themes, current):
    cards = "\n".join(
        f'<a href="{t}/"><iframe src="{t}/" loading="lazy" tabindex="-1" title="{t}"></iframe>'
        f'<span>{t}{" (deployed)" if t == current else ""}</span></a>'
        for t in themes
    )
    return f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>bilby homepage designs</title>
<link rel="icon" href="../static/img/bilby-logo.jpg">
<style>
body{{margin:0;font:16px/1.5 system-ui,sans-serif;background:#eef4fa;color:#0b2540;padding:32px 16px}}
h1{{margin:0 0 4px;font-size:1.6rem}} p{{margin:0 0 24px;color:#3b5672}}
main{{max-width:1400px;margin:auto}} .grid{{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr))}}
a{{display:block;color:inherit;text-decoration:none;background:#fff;border-radius:12px;overflow:hidden;
box-shadow:0 1px 3px #0b254022,0 8px 24px #0b254014;transition:transform .15s}} a:hover{{transform:translateY(-3px)}}
iframe{{width:250%;height:1750px;border:0;transform:scale(.4);transform-origin:0 0;margin-bottom:-1050px;pointer-events:none;display:block}}
span{{display:block;padding:12px 16px;font-weight:600;border-top:1px solid #d6e4f0;text-transform:capitalize}}
</style><main><h1>bilby homepage: design previews</h1>
<p>Each design renders the same content from <code>content/</code>. Set <code>theme:</code> in <code>content/site.yaml</code> to choose what is deployed.</p>
<div class="grid">{cards}</div></main></html>
"""


# --------------------------------------------------------------- commands


def new_announcement(title):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:50]
    path = CONTENT / "announcements" / f"{TODAY.isoformat()}-{slug}.md"
    path.write_text(f"""---
title: {json.dumps(title)}
date: {TODAY.isoformat()}
# link: https://...           # optional: where the title links to
# tag: Event                  # optional: a short label (Release, Event, Paper, ...)
# expires: {TODAY + dt.timedelta(days=60)}     # optional: hide after this date
# pinned: true                # optional: also show as the banner at the top of the page
---

Write the announcement here, in Markdown. The first paragraph is used as the summary.
""")
    print(f"created {path.relative_to(ROOT)}")


def serve(port, offline):
    import functools
    import http.server

    build(all_themes=True, offline=offline)
    watched = [CONTENT, THEMES, STATIC, Path(__file__)]

    def snapshot():
        return {p: p.stat().st_mtime for root in watched
                for p in ([root] if root.is_file() else root.rglob("*")) if p.is_file()}

    def watch():
        last = snapshot()
        while True:
            time.sleep(1)
            current = snapshot()
            if current != last:
                last = current
                # A fresh process, so edits to build.py itself take effect too;
                # a failed build is reported and the server keeps running.
                subprocess.run([sys.executable, __file__, "--all", "--offline"], check=False)

    threading.Thread(target=watch, daemon=True).start()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving http://localhost:{port}/  (designs: http://localhost:{port}/preview/)")
        httpd.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", nargs="?", default="build", choices=["build", "serve", "new"])
    parser.add_argument("title", nargs="?", help="title for `new`")
    parser.add_argument("--all", action="store_true", help="also build every theme under _site/preview/")
    parser.add_argument("--offline", action="store_true", help="use cached live data only")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.command == "new":
        if not args.title:
            parser.error("`new` needs a title")
        new_announcement(args.title)
    elif args.command == "serve":
        serve(args.port, args.offline)
    else:
        build(all_themes=args.all, offline=args.offline)


if __name__ == "__main__":
    main()
