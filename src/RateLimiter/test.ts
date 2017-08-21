/// <reference path="../../node_modules/@types/mocha/index.d.ts"/>
/// <reference path="../../node_modules/@types/chai/index.d.ts"/>

import {expect, use, should} from 'chai';

should()
import * as chaiAsPromised from 'chai-as-promised'

use(chaiAsPromised)

import * as sinon from 'sinon'

import RateLimit, {RATELIMIT_TYPE} from '../RateLimit/index';
import RateLimiter, {STRATEGY} from './index';
import RiotRateLimiterParameterError from '../errors/RiotRateLimiterParameterError';

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

  describe('isSynchingWithHeaders()', function () {
    let limiter: RateLimiter;

    beforeEach(function () {
      limiter = new RateLimiter({limits: [new RateLimit({requests: 1, seconds: 100, type: RATELIMIT_TYPE.SYNC}, {debug: true})]});
    });
    it('is true if the init ratelimit type is present', function () {
      limiter.isSynchingWithHeaders().should.be.true
    });
    it('is true if the init ratelimit type is present among other limits', function () {
      limiter.addLimit(new RateLimit({seconds: 1, requests: 200}, {debug: true}))
      limiter.isSynchingWithHeaders().should.be.true
    });
  });
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

      // expect(() => { // won't compile
      //   new RateLimiter({})
      // }).to.throw()
    });
    it('can limit acchordingly with STRATEGY.BURST', function () {
      const numScheduled = 300
      scheduleNExecutions(limiter, numScheduled)
      limiter.setStrategy(STRATEGY.BURST)

      let expectedQueueSize = numScheduled - limit10per1.requests
      expect(limiter.getQueueSize()).equals(expectedQueueSize)
      clock.tick(200 + limit10per1.seconds * 1000)

      expectedQueueSize -= limit10per1.requests
      expect(limiter.getQueueSize()).equals(expectedQueueSize)
    });
    it('can limit acchordingly with STRATEGY.SPREAD', function () {
      limiter.setStrategy(STRATEGY.SPREAD)

      const numScheduled = 300
      scheduleNExecutions(limiter, numScheduled)

      let expectedQueueSize = numScheduled
      expect(limiter.getQueueSize()).equals(expectedQueueSize)

      clock.tick(limit10per1.seconds * 1000 / 10)
      expectedQueueSize -= (limit10per1.requests / 10)
      expect(limiter.getQueueSize()).equals(expectedQueueSize)
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
      limiter     = new RateLimiter({limits: [lowerLimit, higherLimit]}, {debug})
    });
    describe('With STRATEGY.BURST', function () {
      beforeEach(function () {
        scheduleNExecutions(limiter, numScheduledExecutions)
      });
      it('the lowest limit per second is the limiting one', function () {
        limiter.getQueueSize().should.equal(numScheduledExecutions - lowerLimit['requests'])

        clock.tick(200 + lowerLimit['seconds'] * 1000)
        limiter.getQueueSize().should.equal(numScheduledExecutions - 2 * lowerLimit['requests'])

        clock.tick(200 + (lowerLimit['seconds'] * 1000)) // 100 extra to give limiter time to trigger queue
        // execution
        limiter.getQueueSize().should.equal(numScheduledExecutions - 3 * lowerLimit['requests'])
      });
      it('the higher limit can be the limiting one if the interval is high enough', function () {
        // confusing test...
        higherLimit.update({seconds: lowerLimit['seconds'] * 10})
        let expected = numScheduledExecutions - lowerLimit['requests']
        limiter.getQueueSize().should.equal(expected) // we had 1 times the lower limit when scheduling, maxed out now

        clock.tick(lowerLimit['seconds'] * 4 * 1000) // we reset lower limit multiple times
        expected -= higherLimit['requests'] // but only 1 more time the higher limit is processed
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
        limiter1.getQueueSize().should.equal(numScheduledExecutions - limit10per1['requests'])
        limiter2.getQueueSize().should.equal(numScheduledExecutions)
      });

      it('will randomly switch between who gets to use the next burst limit if it is fully used', function () {
        limiter1.getQueueSize().should.equal(numScheduledExecutions - limit10per1['requests'])
        limiter2.getQueueSize().should.equal(numScheduledExecutions)

        clock.tick(200 + limit10per1['seconds'] * 1000)

        expect(limiter1.getQueueSize() + limiter2.getQueueSize())
          .equals((numScheduledExecutions * 2) - 2 * limit10per1['requests'])
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

  // describe('update()', function () {
  //   describe('STRATEGY.BURST', function () {
  //     let limiter5PerSec: RateLimiter
  //     const scheduledExecutions = 50
  //     beforeEach(function () {
  //       const setInterval = 1
  //       limiter5PerSec    = new RateLimiter({
  //         limit          : 5,
  //         intervalSeconds: setInterval,
  //         type           : 'app',
  //         strategy       : RateLimiter.STRATEGY.BURST,
  //         debug          : true
  //       })
  //       scheduleNExecutions(limiter5PerSec, scheduledExecutions)
  //     });
  //     it('changing only the limit will yield immediate results', function () {
  //       const limiter         = limiter5PerSec
  //       let limit             = limiter.getLimit()
  //       let expectedQueueSize = scheduledExecutions - limit.requests
  //       expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //
  //       clock.tick(limit.seconds * 1000)
  //       expectedQueueSize -= limit.requests
  //       expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //
  //       // limit = limiter.update({limit: 1})
  //       // expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //       //
  //       // clock.tick(limit.seconds * 1000)
  //       // expectedQueueSize -= limit.requests
  //       // expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //       //
  //       // clock.tick(limit.seconds * 1000)
  //       // expectedQueueSize -= limit.requests
  //       // expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //     });
  //
  //     // TODO: is this desirable behaviour or not?
  //     it('changing the limit to something higher then before will immediatly execute the difference to the so far counted executions', function () {
  //       const limiter = limiter5PerSec
  //       let limit     = limiter.getLimit()
  //
  //       let expectedQueueSize = scheduledExecutions - limit.requests
  //       expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //       limit = limiter.update({limit: 1})
  //       clock.tick(limit.seconds * 1000)
  //       expectedQueueSize -= limit.requests
  //
  //       expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //
  //       limit = limiter.update({limit: 5})
  //       expectedQueueSize -= limit.requests - 1
  //
  //       expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //
  //       clock.tick(limit.seconds * 1000)
  //       expectedQueueSize -= limit.requests
  //       expect(limiter.getQueueSize()).equals(expectedQueueSize)
  //
  //     });
  //
  //
  //     it('changing only the interval will yield immediate results', function () {
  //       expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 5)
  //       clock.tick(1000) // 5 more allowed
  //       expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 10)
  //       expect(limiter5PerSec['throttleCount']).equals(5)
  //
  //       // limit stays the same ( for the current interval already all executions spent)
  //       limiter5PerSec.update({
  //         intervalSeconds: 5 // will result in 5 seconds
  //       })
  //       expect(limiter5PerSec['throttleCount']).equals(5)
  //
  //       clock.tick(1000) // no more allowed for additional 4 seconds
  //
  //       expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 10) // so no more requests will be done
  //       //
  //       // clock.tick(1000)
  //       // expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 15) // so no more requests will be done
  //       //
  //       // clock.tick(4000) // 5 more allowed (interval resets)
  //       // expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 20)
  //       //
  //       // limiter5PerSec.update({
  //       //   intervalSeconds: 0
  //       // })
  //       // clock.tick(2000) // 10 more allowed
  //       // expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 30)
  //     });
  //   });
  //   describe('STRATEGY.SPREAD', function () {
  //     let limiter5PerSec: RateLimiter
  //     const scheduledExecutions = 11
  //     beforeEach(function () {
  //       limiter5PerSec = new RateLimiter({
  //         limit          : 5,
  //         intervalSeconds: 1,
  //         type           : 'app',
  //         strategy       : RateLimiter.STRATEGY.SPREAD,
  //         debug          : true
  //       })
  //       expect(limiter5PerSec.getLimit().seconds).equals(1)
  //       scheduleNExecutions(limiter5PerSec, scheduledExecutions)
  //     });
  //     it('immediately changes the time between executions acchordingly', function () {
  //       expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 1)
  //
  //       clock.tick(1000)
  //       expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 6)
  //       limiter5PerSec.update({limit: 1})
  //
  //       clock.tick(1000)
  //       expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 7)
  //       limiter5PerSec.update({limit: 2})
  //       clock.tick(1000)
  //       expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 9)
  //       clock.tick(1000)
  //       expect(limiter5PerSec.getQueueSize()).equals(scheduledExecutions - 11)
  //     });
  //   });
  // });

})
//   // describe('compare() sorts bigger intervals and more requests in front', function () {
//   //
//   //   it('returns 0 if they are equal', function () {
//   //     const limiter = new RateLimiter({
//   //       limit: 3, intervalSeconds: 5, type: 'app',
//   //       debug: true
//   //     })
//   //     RateLimiter.compare(limiter, limiter).should.equal(0)
//   //   });
//   //   describe('different intervals', function () {
//   //     it('returns < 0 if the first argument has a bigger interval', function () {
//   //       const smallerInterval = new RateLimiter({
//   //         limit: 3, intervalSeconds: 2, type: 'app',
//   //         debug: true
//   //       })
//   //       const biggerInterval  = new RateLimiter({
//   //         limit: 3, intervalSeconds: 5, type: 'app',
//   //         debug: true
//   //       })
//   //       RateLimiter.compare(biggerInterval, smallerInterval).should.be.below(0)
//   //     });
//   //     it('returns > 0 if the second argument has a bigger interval', function () {
//   //       const biggerInterval  = new RateLimiter({
//   //         limit: 3, intervalSeconds: 5, type: 'app',
//   //         debug: true
//   //       })
//   //       const smallerInterval = new RateLimiter({
//   //         limit: 3, intervalSeconds: 2, type: 'app',
//   //         debug: true
//   //       })
//   //       RateLimiter.compare(smallerInterval, biggerInterval).should.be.above(0)
//   //     });
//   //   });
//   //   describe('same intervals', function () {
//   //     it('returns < 0 if the first argument has more requests', function () {
//   //       const biggerLimit  = new RateLimiter({
//   //         limit: 6, intervalSeconds: 5, type: 'app',
//   //         debug: true
//   //       })
//   //       const smallerLimit = new RateLimiter({
//   //         limit: 3, intervalSeconds: 5, type: 'app',
//   //         debug: true
//   //       })
//   //       RateLimiter.compare(biggerLimit, smallerLimit).should.be.below(0)
//   //     });
//   //     it('returns > 0 if the second argument has more requests', function () {
//   //       const biggerLimit  = new RateLimiter({
//   //         limit: 6, intervalSeconds: 5, type: 'app',
//   //         debug: true
//   //       })
//   //       const smallerLimit = new RateLimiter({
//   //         limit: 3, intervalSeconds: 5, type: 'app',
//   //         debug: true
//   //       })
//   //       RateLimiter.compare(smallerLimit, biggerLimit).should.be.above(0)
//   //     });
//   //   });
//   // });
//
//
//   describe('STRATEGY.BURST', function () {
//     it('uses the chained limiter additionally to the first one', function () {
//       scheduleNExecutions(firstInChain10PerSec, 11)
//       console.log(firstInChain10PerSec.toString())
//
//       expect(firstInChain10PerSec.getQueueSize()).equals(1) // all but 1 instantly through
//       expect(limiter3PerSec.getQueueSize()).equals(7) // all but 3 of those hang in here
//       expect(firstInChain10PerSec.getQueueSizeForChain()).equals(10)
//
//       clock.tick(1000)
//
//       console.log(firstInChain10PerSec.toString())
//       expect(limiter3PerSec.getQueueSize()).equals(5)
//       expect(limiter3PerSec.getQueueSizeForChain()).equals(9)
//
//       clock.tick(9000)
//       console.log(firstInChain10PerSec.toString())
//
//       expect(limiter3PerSec.getQueueSize()).equals(0)
//       expect(firstInChain10PerSec.getQueueSizeForChain()).equals(0)
//     });
//   });
//   describe('STRATEGY.SPREAD', function () {
//     beforeEach(function () {
//       limiter1PerSec.setStrategy(RateLimiter.STRATEGY.SPREAD)
//     });
//     it('uses the biggest spread interval across all chained limiters', function () {
//       const expected = limiter1PerSec.getSpreadInterval()
//       expect(firstInChain10PerSec.getSpreadInterval()).equals(expected)
//       expect(limiter3PerSec.getSpreadInterval()).equals(expected)
//       expect(lastInChain2PerSec.getSpreadInterval()).equals(expected)
//     });
//
//     it('uses only the queue of the first limiter in chainInOrder', function () {
//       scheduleNExecutions(lastInChain2PerSec, 11)
//
//       expect(limiter3PerSec.getQueueSize()).equals(0)
//       expect(firstInChain10PerSec.getQueueSize()).equals(10)
//     });
//   });
//
//   describe('queue usage in chained limiters: ', function () {
//
//     describe('immediately executed items depends on the lowest ratelimiter in the chainInOrder', function () {
//       const numScheduledExecutions = 11
//       beforeEach(function () {
//
//       });
//       it('1 per interval', function () {
//         const limiter = new RateLimiter({
//           limit          : 1000,
//           intervalSeconds: 1,
//           type           : 'app'
//         }).chainInOrder(new RateLimiter({
//           limit          : 1,
//           intervalSeconds: 1, type: 'app',
//           debug          : true
//         })).chainInOrder(new RateLimiter({
//           limit: 20, intervalSeconds: 1, type: 'app',
//           debug: true
//         }))
//         scheduleNExecutions(limiter, numScheduledExecutions)
//
//         const expected = numScheduledExecutions - 1
//         const actual   = limiter.getQueueSizeForChain()
//         expect(actual).equals(expected)
//       });
//       it('2 per interval', function () {
//         const limiter = new RateLimiter({
//           limit          : 1000,
//           intervalSeconds: 1,
//           type           : 'app'
//         }).chainInOrder(new RateLimiter({
//           limit          : 20,
//           intervalSeconds: 1, type: 'app',
//           debug          : true
//         })).chainInOrder(new RateLimiter({
//           limit: 2, intervalSeconds: 1, type: 'app',
//           debug: true
//         }))
//         scheduleNExecutions(limiter, numScheduledExecutions)
//
//         const expected = numScheduledExecutions - 2
//         const actual   = limiter.getQueueSizeForChain()
//         expect(actual).equals(expected)
//       });
//     });
//     it('if a limiter reaches it\'s capacity, it does not pass executions along immediately', function () {
//       const numScheduledItems = 11
//       scheduleNExecutions(limiter3PerSec, numScheduledItems)
//
//       expect(limiter3PerSec.getQueueSize()).equals(numScheduledItems - 3) // 3 passed along immediately
//       expect(lastInChain2PerSec.getQueueSize()).equals(3 - 2) // 3 from previous limiter, 2 passed along immediately
//       expect(limiter1PerSec.getQueueSize()).equals(1) // 2 coming from previous limiter, 1 executed immediately
//
//       expect(limiter3PerSec.getQueueSizeForChain()).equals(numScheduledItems - 1)
//     });
//     it('if a limiter\`s interval resets, the next batch of executions is passed along', function () {
//       const numScheduledItems = 11
//       scheduleNExecutions(limiter3PerSec, numScheduledItems)
//
//       expect(limiter3PerSec.getQueueSize()).equals(numScheduledItems - 3) // 3 passed along immediately
//       expect(lastInChain2PerSec.getQueueSize()).equals(3 - 2) // 3 from previous limiter, 2 passed along immediately
//       expect(limiter1PerSec.getQueueSize()).equals(1) // 2 coming from previous limiter, 1 executed immediately
//       expect(lastInChain2PerSec.getQueueSizeForChain()).equals(10)
//
//       clock.tick(limiter1PerSec.getLimit().seconds * 1000)
//
//       expect(limiter3PerSec.getQueueSize()).equals(numScheduledItems - 3 - 3) // passing along 3 additional exec.
//       expect(lastInChain2PerSec.getQueueSize()).equals(6 - 4) // 2*3 from previous limiter, 4 passed along
//       expect(limiter1PerSec.getQueueSize()).equals(4 - 2) // 2*2 from previous limiter, 2 executed
//       expect(lastInChain2PerSec.getQueueSizeForChain()).equals(9) // 2 coming from previous limiter, 1 executed
//
//       expect(limiter3PerSec.getQueueSizeForChain()).equals(numScheduledItems - 1 - 1)
//     });
//   });
// });
//
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
//
// describe('.unchain()', function () { // TODO
//   let limiter1_10PerSec, limiter4_1PerSec, limiter3_2PerSec, limiter2_3PerSec;
//   beforeEach(function () {
//     limiter1_10PerSec = new RateLimiter({
//       limit: 10, intervalSeconds: 1, type: 'app',
//       debug: true
//     })
//     limiter2_3PerSec  = new RateLimiter({
//       limit: 3, intervalSeconds: 1, type: 'app',
//       debug: true
//     })
//     limiter3_2PerSec  = new RateLimiter({
//       limit: 2, intervalSeconds: 1, type: 'app',
//       debug: true
//     })
//     limiter4_1PerSec  = new RateLimiter({
//       limit: 1, intervalSeconds: 1, type: 'app',
//       debug: true
//     })
//
//     limiter4_1PerSec.chainInOrder(limiter3_2PerSec).chainInOrder(limiter2_3PerSec).chainInOrder(limiter1_10PerSec)
//   });
//
//   it('limiter will not take any new schedules after being unchained', function () {
//     limiter3_2PerSec.unchain()
//     return limiter3_2PerSec.scheduling(() => { console.log('scheduled item')}).should.eventually.be.rejected
//   });
//   it('removing the only limiter in chain will throw an error', function () {
//     expect(() => {
//       new RateLimiter({
//         limit: 14, intervalSeconds: 2, type: 'app',
//         debug: true
//       }).unchain(RateLimiter.UNCHAIN_LAST_STRATEGY.FIRST)
//     }).to.throw(RiotRateLimiterUnchainError, 'only')
//     expect(() => {
//       new RateLimiter({
//         limit: 14, intervalSeconds: 2, type: 'app',
//         debug: true
//       }).unchain(RateLimiter.UNCHAIN_LAST_STRATEGY.PREVIOUS)
//     }).to.throw(RiotRateLimiterUnchainError, 'only')
//   });
//
//   describe('removing the last limiter in chain', function () {
//     let removedLimiter, targetLimiter
//     beforeEach(function () {
//       scheduleNExecutions(limiter1_10PerSec, 110)
//       limiter1_10PerSec.getQueueSize().should.equal(100)
//
//       limiter1_10PerSec.getLastInChain().should.equal(limiter4_1PerSec)
//     });
//
//     describe('with UNCHAIN_LAST_STRATEGY.FIRST', function () {
//       const UNCHAIN_STRATEGY        = RateLimiter.UNCHAIN_LAST_STRATEGY.FIRST
//       const expectedAsLastArrayItem = 'shouldBeLastInArray'
//
//       beforeEach(function () {
//         targetLimiter = limiter4_1PerSec.getFirstInChain()
//         targetLimiter.queue.push(expectedAsLastArrayItem)
//
//         limiter4_1PerSec.unchain(UNCHAIN_STRATEGY)
//         removedLimiter = limiter4_1PerSec
//       });
//
//       it('limiter is removed from Chain', function () {
//         expect(removedLimiter.previousLimiter).null
//         expect(removedLimiter.nextLimiter).null
//
//         targetLimiter.getLastInChain().should.equal(limiter3_2PerSec)
//       });
//       it('queue from the limiter is passed to the first limiter in chain', function () {
//         removedLimiter.queue.should.be.empty
//         targetLimiter.queue.should.have.length.above(1)
//       });
//       it('queue from the limiter is added to be executed before already present items in the target limiter', function () {
//         expect(targetLimiter.queue[targetLimiter.queue.length - 1]).to.equal(expectedAsLastArrayItem)
//       });
//       it('moved queue will be executed acchordingly in the new limiter', function () {
//         const expectedQueueSize = targetLimiter.getQueueSize() - targetLimiter.getLimit().requests
//         clock.tick(targetLimiter.getLimit().seconds * 1000)
//         expect(targetLimiter.getQueueSize()).to.equal(expectedQueueSize)
//       });
//     });
//     describe('with UNCHAIN_LAST_STRATEGY.PREVIOUS', function () {
//       const UNCHAIN_STRATEGY        = RateLimiter.UNCHAIN_LAST_STRATEGY.PREVIOUS
//       const expectedAsLastArrayItem = 'shouldBeLastInArray'
//
//       beforeEach(function () {
//         targetLimiter = limiter4_1PerSec.previousLimiter
//         targetLimiter.queue.push(expectedAsLastArrayItem)
//
//         limiter4_1PerSec.unchain(UNCHAIN_STRATEGY)
//         removedLimiter = limiter4_1PerSec
//
//       });
//
//       it('limiter is removed from Chain', function () {
//         expect(removedLimiter.previousLimiter).null
//         expect(removedLimiter.nextLimiter).null
//
//         targetLimiter.getLastInChain().should.equal(limiter3_2PerSec)
//       });
//       it('queue from the limiter is passed to the previous limiter', function () {
//         removedLimiter.queue.should.be.empty
//         targetLimiter.queue.should.have.length.above(1)
//       });
//       it('queue from the limiter is added to be executed before already present items in the target limiter', function () {
//         expect(targetLimiter.queue[targetLimiter.queue.length - 1]).to.equal(expectedAsLastArrayItem)
//       });
//     });
//   });
//   describe('removing a limiter other then the last one in chain', function () {
//     let removedLimiter, targetLimiter
//     const expectedAsFirstArrayItem = 'shouldBeFirstInArray'
//     const UNCHAIN_STRATEGY         = RateLimiter.UNCHAIN_LAST_STRATEGY.PREVIOUS
//
//     beforeEach(function () {
//       targetLimiter = limiter3_2PerSec.nextLimiter
//       targetLimiter.queue.push(expectedAsFirstArrayItem)
//
//       scheduleNExecutions(limiter3_2PerSec, 20)
//
//       limiter3_2PerSec.unchain(UNCHAIN_STRATEGY)
//       removedLimiter = limiter3_2PerSec
//     });
//
//
//     it('limiter is removed from Chain', function () {
//       expect(removedLimiter.previousLimiter).null
//       expect(removedLimiter.nextLimiter).null
//
//       targetLimiter.previousLimiter.getLimit().should.deep.equal(limiter2_3PerSec.getLimit())
//     });
//     it('queue from the limiter is passed to the next limiter in chain', function () {
//       removedLimiter.queue.should.be.empty
//       targetLimiter.queue.should.have.length.above(1)
//     });
//     it('queue from the limiter is added to be executed after already present items in the target limiter', function () {
//       expect(targetLimiter.queue[0]).to.equal(expectedAsFirstArrayItem)
//     });
//   });
// });

