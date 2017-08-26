/// <reference path="../../node_modules/@types/mocha/index.d.ts"/>
/// <reference path="../../node_modules/@types/chai/index.d.ts"/>

import {expect, use, should} from 'chai';

should()
import * as chaiAsPromised from 'chai-as-promised'

use(chaiAsPromised)

import * as sinon from 'sinon'

import {RateLimit} from '../RateLimit/index';
import {RateLimiter, STRATEGY} from './index';
import {RiotRateLimiterParameterError} from '../errors/RiotRateLimiterParameterError';

function scheduleNExecutions(limiter, numExecutions) {
  for (let i = 0; i < numExecutions; i++) {
    limiter.scheduling(() => {
      console.log(new Date())
    })
  }
}

describe('RateLimiter', function () {

  let clock: any

  beforeEach(function () {
    clock = sinon.useFakeTimers()
  });
  afterEach(function () {
    clock.restore()
  })

  describe('Sanity Tests:', function () {
    let limiter, limit10per1
    beforeEach(function () {
      limit10per1 = new RateLimit({requests: 10, seconds: 1}, {debug: true})

      limiter = new RateLimiter({
        limits: [limit10per1],
        debug : true
      })
    });

    it('at least 1 limit has to be provided on instantiation', function () {
      expect(() => {
        new RateLimiter({limits: []})
      }).to.throw(RiotRateLimiterParameterError)

      expect(() => {
        new RateLimiter({limits: null})
      }).to.throw(RiotRateLimiterParameterError)

    });

    it('can limit acchordingly with STRATEGY.BURST', function () {
      const numScheduled = 300
      scheduleNExecutions(limiter, numScheduled)
      limiter.setStrategy(STRATEGY.BURST)

      let expectedQueueSize = numScheduled - limit10per1.getMaximumRequests(STRATEGY.BURST)
      expect(limiter.getQueueSize()).equals(expectedQueueSize)
      clock.tick(200 + limit10per1.seconds * 1000)

      expectedQueueSize -= limit10per1.getMaximumRequests(STRATEGY.BURST)
      expect(limiter.getQueueSize()).equals(expectedQueueSize)
    });
    it('can limit acchordingly with STRATEGY.SPREAD', function () {
      limiter.setStrategy(STRATEGY.SPREAD)

      const numScheduled = 300
      scheduleNExecutions(limiter, numScheduled)

      let expectedQueueSize = numScheduled
      expect(limiter.getQueueSize()).equals(expectedQueueSize)

      clock.tick(limit10per1.seconds * 1000 / 10)
      expectedQueueSize -= (limit10per1.getMaximumRequests(STRATEGY.BURST) / 10)
      expect(limiter.getQueueSize()).equals(Math.floor(expectedQueueSize))
    });
  })
  describe('multiple limits', function () {
    let higherLimit: RateLimit, lowerLimit: RateLimit
    let limiter: RateLimiter
    const numScheduledExecutions = 100

    const debug = true

    beforeEach(function () {
      higherLimit = new RateLimit({requests: 10, seconds: 1, debug})
      lowerLimit  = new RateLimit({requests: 5, seconds: 1}, {debug})
      limiter     = new RateLimiter({limits: [lowerLimit, higherLimit], debug})
    });
    describe('With STRATEGY.BURST', function () {
      beforeEach(function () {
        scheduleNExecutions(limiter, numScheduledExecutions)
      });
      it('the lowest limit per second is the limiting one', function () {
        limiter.getQueueSize().should.equal(numScheduledExecutions - lowerLimit.getMaximumRequests(STRATEGY.BURST))

        clock.tick(200 + lowerLimit['seconds'] * 1000)
        limiter.getQueueSize().should.equal(numScheduledExecutions - 2 * lowerLimit.getMaximumRequests(STRATEGY.BURST))

        clock.tick(200 + (lowerLimit['seconds'] * 1000)) // 100 extra to give limiter time to trigger queue
        // execution
        limiter.getQueueSize().should.equal(numScheduledExecutions - 3 * lowerLimit.getMaximumRequests(STRATEGY.BURST))
      });
      it('the higher limit can be the limiting one if the interval is high enough', function () {
        // confusing test...
        higherLimit.update({seconds: lowerLimit['seconds'] * 10})
        let expected = numScheduledExecutions - lowerLimit.getMaximumRequests(STRATEGY.BURST)
        limiter.getQueueSize().should.equal(expected) // we had 1 times the lower limit when scheduling, maxed out now

        clock.tick(lowerLimit['seconds'] * 4 * 1000) // we reset lower limit multiple times
        expected -= higherLimit.getMaximumRequests(STRATEGY.BURST) // but only 1 more time the higher limit is processed
        limiter.getQueueSize().should.equal(expected)
      });
    });
    describe('With STRATEGY.SPREAD', function () {
      beforeEach(function () {
        limiter.setStrategy(STRATEGY.SPREAD)
        scheduleNExecutions(limiter, numScheduledExecutions)
      });
      it('the lowest limit per second is the limiting one', function () {
        limiter.getQueueSize().should.equal(numScheduledExecutions)

        clock.tick(higherLimit.getSpreadInterval()) // interval is too short since the lower limit is the more restrictive limit
        limiter.getQueueSize().should.equal(numScheduledExecutions)

        clock.tick(lowerLimit.getSpreadInterval())
        limiter.getQueueSize().should.equal(numScheduledExecutions - 1)
      });

      it('the limiter uses the lowest spreadInterval', function () {
        limiter['getSpreadInterval']().should.equal(lowerLimit.getSpreadInterval())
      });
    });
  })

  describe('addLimit()', function () {
    let limitToAdd, limiter
    beforeEach(function () {
      limiter    = new RateLimiter({limits: [new RateLimit({seconds: 1, requests: 10}, {debug: true})]})
      limitToAdd = new RateLimit({requests: 20, seconds: 5}, {debug: true})
      limiter.addLimit(limitToAdd)
    });
    it('adds the limit to the limiters limits', function () {
      expect(limiter.getLimits().find(limit => limit.equals(limitToAdd))).to.exist
    });
    it('does not add the limiter to the RateLimit limiters if it is already in there', function () {
      limiter.addLimit(limitToAdd)
      expect(limitToAdd.limiters.length).to.equal(1)
    });

    it('adds the limiter to the RateLimit limiters', function () {
      expect(limitToAdd.limiters.length).to.equal(1)
    });
    it('does not add the limiter if it is already in there', function () {
      limiter.addLimit(limitToAdd)
      expect(limitToAdd.limiters.length).to.equal(1)
    });
  });
  describe('removeLimit()', function () {
    let limitToRemove, limiter
    beforeEach(function () {
      limitToRemove = new RateLimit({requests: 20, seconds: 5}, {debug: true})
      limiter       = new RateLimiter({limits: [limitToRemove]})
      limiter.removeLimit(limitToRemove)
    });
    it('adds the limit to the limiters limits', function () {
      expect(limiter.getLimits().find(limit => limit.equals(limitToRemove))).to.not.exist
    });
    it('does not add the limiter to the RateLimit limiters if it is already in there', function () {
      expect(limitToRemove.limiters.length).to.equal(0)
    });
  });

  describe('sharing limits between limiters', function () {
    let limit10per1
    let limiter1: RateLimiter, limiter2: RateLimiter
    const debug = true

    beforeEach(function () {
      limit10per1 = new RateLimit({requests: 10, seconds: 1}, {debug})
      limiter1    = new RateLimiter({limits: [limit10per1], debug})
      limiter2    = new RateLimiter({limits: [limit10per1], debug})
    });
    describe('With STRATEGY.BURST', function () {
      const numScheduledExecutions = 100

      beforeEach(function () {
        scheduleNExecutions(limiter1, numScheduledExecutions)
        scheduleNExecutions(limiter2, numScheduledExecutions)
      });
      it('The initial executions for the limit will go to the limiter first scheduling it', function () {
        limiter1.getQueueSize().should.equal(numScheduledExecutions - limit10per1.getMaximumRequests(STRATEGY.BURST))
        limiter2.getQueueSize().should.equal(numScheduledExecutions)
      });

      it('will randomly switch between who gets to use the next burst limit if it is fully used', function () {
        limiter1.getQueueSize().should.equal(numScheduledExecutions - limit10per1.getMaximumRequests(STRATEGY.BURST))
        limiter2.getQueueSize().should.equal(numScheduledExecutions)

        clock.tick(200 + limit10per1['seconds'] * 1000)

        expect(limiter1.getQueueSize() + limiter2.getQueueSize())
          .equals((numScheduledExecutions * 2) - 2 * limit10per1.getMaximumRequests(STRATEGY.BURST))
      });
    });
    describe('With STRATEGY.SPREAD', function () {
      const numScheduledExecutions = 100

      beforeEach(function () {
        limiter1.setStrategy(STRATEGY.SPREAD)
        limiter2.setStrategy(STRATEGY.SPREAD)
        scheduleNExecutions(limiter1, numScheduledExecutions)
        scheduleNExecutions(limiter2, numScheduledExecutions)
      });
      it('both limiters use the limit equally', function () {
        limiter1.getQueueSize().should.equal(numScheduledExecutions)
        limiter2.getQueueSize().should.equal(numScheduledExecutions)

        clock.tick(limit10per1.getSpreadInterval())

        limiter1.getQueueSize().should.equal(numScheduledExecutions - 1)
        limiter2.getQueueSize().should.equal(numScheduledExecutions - 1)
        limit10per1['count'].should.equal(2)
      });
    });
    describe.skip('With mixed strategies', function () {
      // TODO: for now this is not intended since it would propably lead to undesired behaviour
      beforeEach(function () {
        limiter1.setStrategy(STRATEGY.BURST)
        limiter2.setStrategy(STRATEGY.SPREAD)
      });
    });
  })
})
// // TODO
// describe('.backoff()', function () {
// });
//
// describe('calcMSUntilReset()', function () {
//   let nowEpochMS
//   beforeEach(function () {
//     nowEpochMS = Date.now()
//   });
//   it('gets the remaining MS until reset if reset was not due yet', function () {
//     expect(RateLimiter.calcMSUntilReset(10, nowEpochMS - 5000)).equals(5000)
//   });
//   it('gets the remaining MS until reset if reset was due once', function () {
//     expect(RateLimiter.calcMSUntilReset(10, nowEpochMS - 15000)).equals(5000)
//   });
//   it('gets the remaining MS until reset if reset was due multiple times', function () {
//     expect(RateLimiter.calcMSUntilReset(10, nowEpochMS - 35000)).equals(5000)
//   });
// });

