/// <reference path="../../node_modules/@types/mocha/index.d.ts"/>
/// <reference path="../../node_modules/@types/chai/index.d.ts"/>

import * as sinon from 'sinon'
import {should} from 'chai';

should()

import RateLimit, {RATELIMIT_TYPE} from './index';

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

  describe('100:1', function () {
    let limit: RateLimit
    beforeEach(function () {
      limit = new RateLimit({requests: 100, seconds: 1})
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
      limit.increment(90)
      limit.check().should.be.true
      limit.increment(10)
      limit.check().should.be.false
    });

    it('provides the remaining requests available', function () {
      limit.increment(90)
      limit.getRemainingRequests().should.equal(10)
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
