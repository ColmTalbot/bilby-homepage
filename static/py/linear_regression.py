import bilby
import numpy as np

# Simulate noisy data from a straight line
rng = np.random.default_rng(42)
x = np.linspace(0, 10, 40)
sigma = 1.0
y = 2.5 * x + 1.0 + rng.normal(0, sigma, x.size)

def model(x, m, c):
    return m * x + c

likelihood = bilby.core.likelihood.GaussianLikelihood(x, y, model, sigma=sigma)
priors = dict(
    m=bilby.core.prior.Uniform(0, 5, "m"),
    c=bilby.core.prior.Uniform(-5, 5, "c"),
)

result = bilby.run_sampler(
    likelihood, priors, sampler="dynesty", nlive=250,
    injection_parameters=dict(m=2.5, c=1.0), label="line",
)
result.plot_corner()
