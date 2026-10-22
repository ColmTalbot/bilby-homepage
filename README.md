# bilby-dev.github.io

The source for the [bilby](https://github.com/bilby-dev/bilby) homepage. It is a static
site built by a small Python script and deployed to GitHub Pages by GitHub Actions. The
[documentation](https://bilby-dev.github.io/bilby/) and the
[in-browser examples](https://bilby-dev.github.io/examples/) live in their own repositories;
this site links to them.

## Common tasks

| I want to… | Do this |
| --- | --- |
| Post an announcement | Add a Markdown file to `content/announcements/` (or run `python build.py new "Title"`). You can do it in the GitHub web editor; the site redeploys on merge. |
| Pin an announcement as the banner | Add `pinned: true` to its front matter. |
| Hide an announcement later | Add `expires: YYYY-MM-DD`. The daily rebuild removes it after that date. |
| Announce a release | Nothing. Each bilby release on GitHub becomes an announcement automatically. |
| Change any text or link | Edit `content/site.yaml`. |
| Add a package to the ecosystem section | Add an entry under `ecosystem.packages` in `content/site.yaml` (name, category, one-line text, link, optional repo). Packages appear in the order listed. The "let us know" line under the list is `ecosystem.invite`. |
| Replace or remove the gallery | Edit `gallery` in `content/site.yaml` (images go in `static/img/`). Set `show_gallery: false` to hide the section and keep the entries. |
| Change or add an in-browser example | Edit or add a file in `static/py/` and list it under `try_examples` in `content/site.yaml`. |
| Launch (remove the "Preliminary" watermark and let search engines index the site) | Nothing. Both happen automatically when the site is deployed at its `url` in `content/site.yaml` (https://bilby-dev.github.io). Deployed anywhere else, or built locally, it keeps the watermark. |

An announcement looks like this:

```markdown
---
title: bilby workshop at the 2027 LVK meeting
date: 2027-03-01
link: https://example.org/workshop   # optional: where the title links
tag: Event                           # optional: a short label
expires: 2027-03-20                  # optional
pinned: true                         # optional: also show as the top banner
---

One or two sentences in Markdown. The first paragraph is used as the summary.
```

## Working locally

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python build.py serve
```

Then open http://localhost:8000/. The site rebuilds whenever a file changes. Other commands:

```bash
.venv/bin/python build.py            # build the site into _site/
.venv/bin/python build.py --offline  # don't contact PyPI/GitHub/doi.org; use .cache/
.venv/bin/python build.py --host bilby-dev.github.io  # build it as deployed, without the watermark
```

## How it fits together

```
content/site.yaml          all text, links, features, samplers, ecosystem, gallery, citations, examples list
content/announcements/     one Markdown file per announcement
templates/                 the page (index.html), its skeleton (base.html) and building blocks
static/                    logo, gallery figures, CSS, JS, in-browser examples
static/fonts/              self-hosted web fonts, with their licences
scripts/fetch_fonts.py     re-downloads static/fonts/ after the fonts change
build.py                   renders everything into _site/
tests/run_examples.mjs     runs the in-browser examples under Pyodide in Node
```

At build time `build.py` fetches:

- the latest bilby version from PyPI (shown in the header, footer and structured data),
- the latest GitHub releases of bilby-dev/bilby (turned into announcements),
- BibTeX for the citation DOIs from doi.org.

Results are cached in `.cache/live.json`. If a request fails, the build uses the cache, or
the `fallback_version` in `site.yaml`.

It also writes `feed.xml` (an Atom feed of announcements) and `announcements.json`, so
other sites, such as the docs, can show the same news.

### The in-browser runner

The "Try bilby" panel runs real bilby, installed from PyPI into [Pyodide](https://pyodide.org)
inside a Web Worker (`static/js/worker.js`). Nothing downloads until someone presses Run.
`static/py/_runner.py` silences progress bars and warnings and collects matplotlib figures.
The Pyodide version is set in `site.yaml`. When you change it, the Check workflow confirms
every example still runs.

## Security

- **Content Security Policy:** every page carries a strict policy (in
  `templates/base.html`). It allows scripts, styles, fonts and images only from this
  site, plus `data:` images for the runner's figures. To use an external resource, such as
  an image hosted elsewhere, add its origin to the policy.
- **Fonts:** fonts are self-hosted, so loading the page contacts no third party. Only the
  in-browser runner, once someone presses Run, downloads Pyodide from jsDelivr and bilby
  from PyPI. It installs exactly the bilby version the site was built against.
- **Release data:** release announcements only use tags that look like versions and links
  to github.com.
- **Workflows:** jobs run with read-only permissions, except the one that publishes to
  Pages. Actions are pinned to commit SHAs, and Dependabot keeps the pins current.

## Automation

- **Deploy** (`.github/workflows/deploy.yml`) builds and publishes on every push to
  `main`, daily (for new releases and expired announcements), on demand, and on a
  `bilby-release` repository dispatch.
- **Check** (`.github/workflows/check.yml`) runs on pull requests and weekly. It builds the
  site, checks every link with lychee, and runs every in-browser example against the
  newest bilby under the configured Pyodide. That catches a bilby release that breaks the
  runner before visitors do.
- **Dependabot** keeps the Actions and Python dependencies current.

To publish immediately when bilby is released, rather than at the next daily build, add a
step like this to bilby's release workflow. It needs a token with `contents: write` on this
repository:

```yaml
- uses: peter-evans/repository-dispatch@v3
  with:
    token: ${{ secrets.HOMEPAGE_DISPATCH_TOKEN }}
    repository: bilby-dev/bilby-dev.github.io
    event-type: bilby-release
```

## First deployment

1. Create the `bilby-dev/bilby-dev.github.io` repository and push this directory to `main`.
2. In Settings → Pages, set **Source** to **GitHub Actions**.
3. The Deploy workflow publishes the site at https://bilby-dev.github.io/.
