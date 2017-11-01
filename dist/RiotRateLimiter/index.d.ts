import { STRATEGY } from '../RateLimiter';
export declare type RiotRateLimiterConstructorOptions = {
    strategy?: STRATEGY;
    debug?: boolean;
};
export declare type RiotRateLimiterOptions = {
    limits: RateLimitOptions[];
    strategy: STRATEGY;
    platformId: string;
    apiMethod: string;
};
import { RateLimit, RATELIMIT_TYPE, RateLimitOptions } from '../RateLimit/index';
export declare class RiotRateLimiter {
    private limitersPerPlatformId;
    private strategy;
    private debug;
    private appLimits;
    constructor({strategy, debug}?: RiotRateLimiterConstructorOptions);
    executing({url, token, resolveWithFullResponse}: {
        url: any;
        token: any;
        resolveWithFullResponse?: boolean;
    }): Promise<{}>;
    private executingScheduledCallback(rateLimiter, {url, token, resolveWithFullResponse});
    private static extractPlatformIdAndMethodFromUrl(url);
    static extractRateLimitFromHeader(type: RATELIMIT_TYPE, rateLimitHeader: string): RateLimitOptions[];
    static extractRateLimitCountsFromHeader(type: RATELIMIT_TYPE, rateLimitCountHeader: string): RateLimitOptions[];
    private static addRequestsCountFromHeader(type, updatedLimits, rateLimitCountHeader);
    toString(url: string): string;
    setStrategy(strategy: STRATEGY): void;
    getLimitsForPlatformId(platformId: string): {
        [apiMethod: string]: RateLimit[];
    };
    getLimits(): {
        [platformId: string]: {
            [apiMethod: string]: RateLimit[];
        };
    };
    private updateAppRateLimits(updateOptions?);
}
