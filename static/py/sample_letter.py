# The bilby logo is a corner plot of samples drawn from letter-shaped
# likelihoods. Here we draw a letter with matplotlib and sample it.
import bilby
import numpy as np
import matplotlib.pyplot as plt
from scipy.interpolate import RegularGridInterpolator

letter = "B"

# Render the letter to a greyscale image
fig = plt.figure(figsize=(1.6, 2), dpi=60)
fig.text(0.5, 0.45, letter, fontsize=110, weight="bold", ha="center", va="center")
fig.canvas.draw()
img = 1 - np.asarray(fig.canvas.buffer_rgba())[::-1, :, 0] / 255
plt.close(fig)

ny, nx = img.shape
interp = RegularGridInterpolator((np.arange(nx), np.arange(ny)), img.T)

class LetterLikelihood(bilby.core.likelihood.Likelihood):
    def log_likelihood(self, parameters):
        # As in the script that made the logo: -1 / (pixel darkness)
        value = interp([parameters["x"], parameters["y"]])[0]
        return -1 / (value + 1e-2)

priors = dict(
    x=bilby.core.prior.Uniform(0, nx - 1, "x"),
    y=bilby.core.prior.Uniform(0, ny - 1, "y"),
)
result = bilby.run_sampler(
    LetterLikelihood(), priors, sampler="dynesty", nlive=1500, label=letter,
)
result.plot_corner(quantiles=None, titles=False, bins=40, smooth=0.6)
