/// <reference path="../../node_modules/@types/mocha/index.d.ts"/>
import * as Promise from 'bluebird'

import {expect, should} from 'chai';

should()

import {RiotRateLimiter} from './';
import {RateLimiter, STRATEGY} from '../RateLimiter/index';
import * as fs from 'fs';
import * as path from 'path';

describe('RiotApiLimiter', () => {
  let limiter: RiotRateLimiter;
  beforeEach(function () {
    limiter = new RiotRateLimiter({strategy: STRATEGY.BURST, debug: true})
  });
  it('can be created', () => {
    expect(limiter).to.be.instanceOf(RiotRateLimiter)
  });

  describe('extractPlatformIdAndMethodFromUrl():', function () {
    const host                                     = 'https://euw1.api.riotgames.com'
    const extractPlaformIdAndMethodFromUrl_private = RiotRateLimiter['extractPlatformIdAndMethodFromUrl']

    it('created the same apiMethod result disregarding the parameters', function () {
      const apiMethod1 = extractPlaformIdAndMethodFromUrl_private(host + '/lol/champion-mastery/v3/champion-masteries/by-summoner/2345226/by-champion/12').apiMethod
      const apiMethod2 = extractPlaformIdAndMethodFromUrl_private(host + '/lol/champion-mastery/v3/champion-masteries/by-summoner/35623626/by-champion/84?api_key').apiMethod

      apiMethod1.should.equal(apiMethod2)
    });
    describe('without any parameter', function () {
      it('works for champions endpoint', function () {
        extractPlaformIdAndMethodFromUrl_private(host + '/lol/platform/v3/champions')
          .should.have.property('platformId').equals('euw1')
        extractPlaformIdAndMethodFromUrl_private(host + '/lol/platform/v3/champions')
          .should.have.property('apiMethod').contains('champions')
      });
    });
    describe('with query parameters', function () {
      it('works for champions endpoint', function () {
        extractPlaformIdAndMethodFromUrl_private(host + '/lol/platform/v3/champions?freeToPlay=true')
          .should.have.property('platformId').equals('euw1')
        extractPlaformIdAndMethodFromUrl_private(host + '/lol/platform/v3/champions?freeToPlay=true')
          .should.have.property('apiMethod').contains('champions')
      });
    });
    describe('with numeric parameters at the end', function () {
      it('works for champions endpoint', function () {
        extractPlaformIdAndMethodFromUrl_private(host + '/lol/platform/v3/champions/1')
          .should.have.property('platformId').equals('euw1')
        extractPlaformIdAndMethodFromUrl_private(host + '/lol/platform/v3/champions/1')
          .should.have.property('apiMethod').contains('champions')
      });
      describe('and query parameter', function () {
        it('works for champions endpoint', function () {
          extractPlaformIdAndMethodFromUrl_private(host + '/lol/platform/v3/champions/1?freeToPlay=true')
            .should.have.property('platformId').equals('euw1')
          extractPlaformIdAndMethodFromUrl_private(host + '/lol/platform/v3/champions/1?freeToPlay=true')
            .should.have.property('apiMethod').contains('champions')
        });
      });
    });
    describe('with multiple numeric parameters', function () {
      it('works for champion-mastery endpoint', function () {
        extractPlaformIdAndMethodFromUrl_private(host + '/lol/champion-mastery/v3/champion-masteries/by-summoner/2345226/by-champion/12')
          .should.have.property('platformId').equals('euw1')
        extractPlaformIdAndMethodFromUrl_private(host + '/lol/champion-mastery/v3/champion-masteries/by-summoner/2345226/by-champion/12')
          .should.have.property('apiMethod').contains('champion-mastery')
      });
      describe('and query paramter', function () {
        it('works for champion-mastery endpoint', function () {
          extractPlaformIdAndMethodFromUrl_private(host + '/lol/champion-mastery/v3/champion-masteries/by-summoner/2345226/by-champion/12?api_key=')
            .should.have.property('platformId').equals('euw1')
          extractPlaformIdAndMethodFromUrl_private(host + '/lol/champion-mastery/v3/champion-masteries/by-summoner/2345226/by-champion/12?api_key=')
            .should.have.property('apiMethod').contains('champion-mastery')
        });
      });
    });
  });
  describe('updateLimiterChain():', function () { // TODO
    let limiter: RateLimiter
    describe('adding new limiters when no limiter exists for given new limits', function () {

    });
    describe('removing limiters when they are not within the new limits', function () {

    });
    describe('updating existing limiters acchording to their limitInterval', function () {

    });
  });

  // NOTE: these tests are meant for manual confirmation and testing since they need an actual API key
  describe.skip('executingRequest', function () {
    describe('endpoint without app-limiting but method-limited', function () {
      const staticDataUrl = 'https://la1.api.riotgames.com/lol/static-data/v3/maps'
      const matchListUrl  = 'https://euw1.api.riotgames.com/lol/match/v3/matchlists/by-account/21777671'
      const summonerUrl   = 'https://euw1.api.riotgames.com/lol/summoner/v3/summoners/87037613'
      // TODO: static data
      it('does something', function () {
        this.timeout(0)
        const promises = []
        for (let i = 0; i < 15; i++) {
          promises.push(limiter.executing({
              url  : staticDataUrl,
              token: fs.readFileSync(path.resolve(__dirname, '../', 'API_KEY'), 'utf-8')
                       .trim()
            }).then(data => console.log(data)).catch(err => console.log(err))
          )
        }
        // console.log('scheduled all requests', limiter.toString(staticDataUrl))
        return Promise.all(promises)
      });
      it('does something with matchlist', function () {
        this.timeout(0)
        let executed       = 0
        let errors         = 0
        const promises     = []
        const numScheduled = 25
        for (let i = 0; i < numScheduled; i++) {
          promises.push(limiter.executing({
            url  : matchListUrl,
            token: fs.readFileSync(path.resolve(__dirname, '../', 'API_KEY'), 'utf-8').trim()
          }).then(() => {
            executed++
            console.log('request done ' + new Date(), executed)
          }).catch(err => {
            console.log(err)
            errors++
          }))
        }
        console.log('scheduled all requests', limiter.toString(matchListUrl))
        setInterval(() => {console.log(limiter.toString(matchListUrl))}, 30000)
        return Promise.all(promises).then(() => {
          console.log(`${executed} succesful, ${errors} 429 from underlying system`)
          expect(executed + errors).equals(numScheduled)
        })
      });
      it('does something with summoner', function () {
        this.timeout(0)
        let executed       = 0
        let errors         = 0
        const promises     = []
        const numScheduled = 150
        for (let i = 0; i < numScheduled; i++) {
          promises.push(limiter.executing({
            url  : summonerUrl,
            token: fs.readFileSync(path.resolve(__dirname, '../', 'API_KEY'), 'utf-8').trim()
          }).then((data) => {
            executed++
            console.log('request done ' + new Date(), executed, data)
          }).catch(err => {
            console.log(err)
            errors++
          }))
        }
        console.log('scheduled all requests', limiter.toString(summonerUrl))
        setInterval(() => {console.log(limiter.toString(summonerUrl))}, 30000)
        return Promise.all(promises).then(() => {
          console.log(`${executed} succesful, ${errors} errors`)
          expect(executed + errors).equals(numScheduled)
        })
      });
    });
    describe.skip('endpoint with App-limit ', function () {
      // TODO: using dev-key
    });
  });
});
