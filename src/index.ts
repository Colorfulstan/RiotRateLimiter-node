import * as engchk from 'runtime-engine-check';

engchk(); // checks node version matches spec in package.json

import {RiotRateLimiter} from './RiotRateLimiter/index'
export = RiotRateLimiter
