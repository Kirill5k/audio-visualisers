import { installSpectralReview } from '../terrain/spectral-review.js';
import { runFixtureChecks } from './signal-atlas-fixture-review.js';
import { runMixControlChecks } from './signal-atlas-mix-review.js';

installSpectralReview({ getApi: () => window.signalAtlas, slug: 'signal-atlas', runFixtureChecks, runMixControlChecks });
