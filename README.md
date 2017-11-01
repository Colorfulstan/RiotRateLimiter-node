# RiotRateLimiter-node

A rate limiter handling rate-limits enforced by the riot-games api. Automatically creates and updates
rate-limiters on a per region and method base,
respecting app-limits, method limits and generic backoff on service/underlying service limits.

## Getting Started

```npm install riot-ratelimiter```
```
  const RiotRateLimiter = require('riot-ratelimiter')
  const limiter = new RiotRateLimiter()

  limiter.executing({
    url: 'validRiotApiUrl',
    token: <RIOT_API_KEY>,

    // will resolve the Promise with the full API response Object
    // omit or set to false if you are only interested in the data.
    // in case of an error (404/500/503) the Promise will always be rejected with the full response.
    resolveWithFullResponse: true
  })
```

### Prerequisites

You need to know how to work with Promises.
This module uses promise-request for the actual requests.

### Automatic limit synchronisation with RIOT Headers

The region and method used will be determined from the given url.
When a new ratelimiter is created (on the first request to a region and method)
a single synchronisation Request will be executed to find out about the relevant limits
and the current limit-counts for that method/region on your API-Key.

This ensures you can not hit more then one 429 (per RiotRateLimiter instance) when starting up your app.
The received limits and counts will then be set acchordingly and used processing additional resets.

See "[Choosing the right strategy](#choosing-the-right-strategy)" below for information on additional synchronisation requests done depending on strategy.

### Choosing the right strategy

We currently offer two strategies for your limiting needs:
```STRATEGY.SPREAD``` (default) and ```STRATEGY.BURST```

#### SPREAD (default)
SPREAD will ensure you don't hit the rate-limit by spreading out the requests to fit into the given time-window and remaining limit-count.
For example if a limit resets every 10 seconds and you can do 100 requests in that window, one request will be done every 0.1 seconds (actually there is a margin of x% to really ensure you don't hit the limit).
This spread-interval is calculated on a per request base using the current limit-counts and limits received from the RIOT API.

This basically means every request done when using STRATEGY.SPREAD will act as a synchronisation request, which should prevent most issues when using it in a multi-instance scenario.

#### BURST (use with care / needs improvements)
BURST will try to execute all the requests you pass in immediately if possible.
This strategy can become highly volatile to getting out of synch with the actual limit-counts on the RIOT API edge, so this should be used with care (and will need improvement over time).
Each time a limit resets, the next request done will act as synchronisation request, to prevent throwing a huge amount of requests into an exceeded limit.

It is recommended for following scenarios:

* single app-instance
* you need to execute a lot of requests in bulk, but don't throw huge bulks at the ratelimiter constantly
* you want to figure out how to improve this issue :)

RiotRateLimiter will keep track of the reset timer for the method, starting from from the synchronisation request.
Because there are no limit-window information given by riot this timer might wait longer then neccessary when the rate-limit will be approached (the full reset time),
even if there are only a few requests left in the limit-count.
All requests that would exceed the limit will be queeud up to be executed as soon as the the limit resets.

## Treatment of Error Responses

### 429 with retry-after Header (App- or Methodlimit exceeded)
These requests will be rescheduled (first in queue) and the executing limiter
will back off for the duration given by the retry-after Header.

### 429 without retry-after Header (Underlying API System)
These requests will be rescheduled (first in queue) and the executing limiter
will backoff generically.

This means it will start with a backoff timer on the first try (eg. 1000 MS)
and increase the backoff time exponentially with each unsuccessful try (2000, 4000, 8000, ...).

### Other errors
Will be passed back to the caller by rejecting the promise returned from ```.executing```

## RateLimits

RateLimit instances are exposed through ```RiotRateLimiter#getLimits``` and ```RiotRateLimiter#getLimitsForPlatformId```.

### General Model

For App RateLimits, the same instances are shared across all RateLimiters.

Each ApiMethod has it's own RateLimiter instance with his own Method RateLimits.

RateLimits and RateLimiters communicate about changes, to keep things in sync internally,
and to be able to synergize with each other.

Each RateLimiter has public access to all of it's RateLimit instances,
and each RateLimit instance has public access to all RateLimiter instances,
that are connected to it.

This strong coupling is desired to a) keep the propably unneccessary
complicated codebase easier to understand and modify and b) for being able
to work directly on references for easy propagation of rate-limit changes,
for example in the App RateLimits.

### Using your own RateLimits

Because of the tight coupling and that RateLimit instances are exposed,
you also have public access to the internal RateLimiters. If you have a special use-case
that temporarily requires extra strict RateLimits, or you just want to have
a bit more control and transparency in what's going on, you can introduce your own RateLimits.
Just be aware, that the public interface is not deliberately designed yet,
so there might be breaking changes somewhen, but it will follow Semantic Versioning.


## Running the tests

You will need to add your (development) api-key to a file ```/src/API_KEY``` to run the tests within ```src/RiotRateLimiter```

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/your/project/tags).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details
