# Is the data better described by a line or a quadratic?
# bilby's nested samplers return the evidence, so model comparison is free.
import bilby
import numpy as np

rng = np.random.default_rng(1)
x = np.linspace(-3, 3, 30)
y = 0.4 * x**2 + 1.2 * x + rng.normal(0, 0.5, x.size)

def line(x, b, c):
    return b * x + c

def quadratic(x, a, b, c):
    return a * x**2 + b * x + c

results = {}
for name, model in [("line", line), ("quadratic", quadratic)]:
    priors = {p: bilby.core.prior.Uniform(-3, 3, p) for p in ["a", "b", "c"]}
    if name == "line":
        priors.pop("a")
    likelihood = bilby.core.likelihood.GaussianLikelihood(x, y, model, sigma=0.5)
    results[name] = bilby.run_sampler(
        likelihood, priors, sampler="dynesty", nlive=200, label=name,
    )

ln_bf = results["quadratic"].log_evidence - results["line"].log_evidence
print(f"ln Bayes factor (quadratic vs line): {ln_bf:.1f}")
results["quadratic"].plot_corner()
