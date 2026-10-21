"""Set-up run once by static/js/worker.js before any user code.

Keeps the output readable in a browser console: no progress bars, no
deprecation noise, and figures are collected as PNGs instead of shown.
"""
import base64
import io
import os
import warnings

os.environ["MPLBACKEND"] = "agg"
os.environ["TQDM_DISABLE"] = "1"
warnings.filterwarnings("ignore")

import logging

import matplotlib

matplotlib.use("agg")
import matplotlib.pyplot as plt
from matplotlib.figure import Figure

RUN_DIR = "/home/pyodide/run"
os.makedirs(RUN_DIR, exist_ok=True)
os.chdir(RUN_DIR)

import bilby

bilby.core.utils.logger.setLevel("INFO")
warnings.filterwarnings("ignore")  # again: importing bilby adds its own filters


class _QuietFilter(logging.Filter):
    """Drop bilby messages that only matter for runs on disk."""

    def filter(self, record):
        message = record.getMessage()
        return not ("save_to_file" in message or "checkpoint" in message.lower())


bilby.core.utils.logger.addFilter(_QuietFilter())

# bilby saves and closes its plots (e.g. result.plot_corner()), so figures are
# captured when saved, as well as any still open when the code finishes.
_saved = []
_original_savefig = Figure.savefig


def _capturing_savefig(self, fname, *args, **kwargs):
    if "checkpoint" not in str(fname) and self not in _saved:
        _saved.append(self)
    return _original_savefig(self, fname, *args, **kwargs)


Figure.savefig = _capturing_savefig


def collect_figures(dpi=90):
    """Return the figures saved or left open by the last run as base64 PNGs."""
    figures = list(_saved)
    figures += [plt.figure(n) for n in plt.get_fignums() if plt.figure(n) not in figures]
    images = []
    for figure in figures:
        buffer = io.BytesIO()
        _original_savefig(figure, buffer, format="png", dpi=dpi, bbox_inches="tight")
        images.append(base64.b64encode(buffer.getvalue()).decode())
    _saved.clear()
    plt.close("all")
    return images


def bilby_version():
    return bilby.__version__
