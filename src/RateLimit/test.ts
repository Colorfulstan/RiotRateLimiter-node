/// <reference path="../../node_modules/@types/mocha/index.d.ts"/>
/// <reference path="../../node_modules/@types/chai/index.d.ts"/>

import * as sinon from 'sinon'
import {should} from 'chai';
import {RateLimit, FACTOR_REQUEST_MARGIN_ABOVE_5_SEC, FACTOR_REQUEST_MARGIN_BELOW_5_SEC, RATELIMIT_TYPE} from './index';
import {STRATEGY} from '../RateLimiter/index';

should()

describe('RateLimit', function () {
  let clock: any
  beforeEach(function () {
    clock = sinon.useFakeTimers()
  });
  afterEach(function () {
    clock.restore()
  })

  it('can be created with minimal arguments', function () {
    const limit = new RateLimit({requests: 100, seconds: 1})
    limit.should.have.property('type').equals(RATELIMIT_TYPE.APP)
    limit.should.have.property('count').equals(0)
    limit.should.have.property('timestampLastReset').equals(Date.now())
  });

  describe('Safety margins', function () {
    let limit: RateLimit
    const requestsSet = 100
    describe('if the ratelimit has a timer of below 5 seconds', function () {
      beforeEach(function () {
        limit = new RateLimit({requests: requestsSet, seconds: 1}, {debug: true})
      });
      it('reduces the maximum requests acchordingly', function () {
        const expected = requestsSet * FACTOR_REQUEST_MARGIN_BELOW_5_SEC
        limit.reset()
        limit.getRemainingRequests(STRATEGY.BURST).should.equal(expected)
      });
    });
    describe('if the ratelimit has a timer above 5 seconds', function () {
      beforeEach(function () {
        limit = new RateLimit({requests: requestsSet, seconds: 10}, {debug: true})
      });
      it('reduces the maximum requests acchordingly', function () {
        const expected = requestsSet * FACTOR_REQUEST_MARGIN_ABOVE_5_SEC
        limit.reset()
        limit.getRemainingRequests(STRATEGY.BURST).should.equal(expected)
      });
    });
  });

  describe('100:1', function () {
    let limit: RateLimit
    beforeEach(function () {
      limit = new RateLimit({requests: 100, seconds: 1}, {debug: true})
    });

    it('resets its own timer', function () {
      limit.increment(90)
      clock.tick(100)
      limit.should.have.property('count').equals(90)
      clock.tick(900)
      limit.should.have.property('count').equals(0)

      // limit.increment(90)
      // clock.tick(100)
      // limit.should.have.property('count').equals(90)
      // clock.tick(901)
      // limit.should.have.property('count').equals(0)
      //
      // limit.increment(90)
      // clock.tick(100)
      // limit.should.have.property('count').equals(90)
      // clock.tick(901)
      // limit.should.have.property('count').equals(0)
    });

    it('provides info on if requests are available', function () {
      limit.increment(50)
      limit.check(STRATEGY.BURST).should.be.true
      limit.increment(50)
      limit.check(STRATEGY.BURST).should.be.false
    });

    it('provides the remaining requests available', function () {
      limit.increment(50)
      limit.getRemainingRequests(STRATEGY.BURST).should.equal(25)
    });

    describe('spreadInterval', function () {
      it('provides the spreadInterval neccessary to exactly fill out the limit', function () {
        limit.getSpreadInterval().should.equal(10)
      });

      it('changes depending on available requests and time', function () {
        limit.increment(50)
        limit.getSpreadInterval().should.equal(20)

        limit.increment(25)
        limit.getSpreadInterval().should.equal(40)

        clock.tick(500)
        limit.getSpreadInterval().should.equal(20)

        // limit resets
        clock.tick(500)
        limit.getSpreadInterval().should.equal(10)
      });
    });
  });

  describe('50/10:3600', function () {
    let limit
    beforeEach(function () {
      limit = new RateLimit({seconds: 3600, requests: 10, count: 50, type: RATELIMIT_TYPE.METHOD, debug: true})
    });
    it('check() returns false', function () {
      limit.check().should.be.false
    });
    it('remainingRequests() should return 0', function () {
      limit.getRemainingRequests().should.equal(0)
    });
  });
});
