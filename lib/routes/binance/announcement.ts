import { Route, ViewType } from '@/types';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import { parseDate } from '@/utils/parse-date';
import * as cheerio from 'cheerio';
import puppeteer from '@/utils/puppeteer';
import ofetch from '@/utils/ofetch';
import { randUserAgent } from '@tonyrl/rand-user-agent';
import { Browser } from 'puppeteer';

const ROUTE_PARAMETERS_CATALOGID_MAPPING = {
    'new-cryptocurrency-listing': 48,
    'latest-binance-news': 49,
    'latest-activities': 93,
    'new-fiat-listings': 50,
    'api-updates': 51,
    'crypto-airdrop': 128,
    'wallet-maintenance-updates': 157,
    delisting: 161,
};
interface BNApiResult {
    code: string;
    message: null;
    messageDetail: null;
    data: Data;
    success: boolean;
}
interface Data {
    catalogs: Catalog[];
}
interface Catalog {
    catalogId: number;
    parentCatalogId: null;
    icon: string;
    catalogName: string;
    description: null;
    catalogType: number;
    total: number;
    articles: Article[];
    catalogs: any[];
}

interface Article {
    id: number;
    code: string;
    title: string;
    type: number;
    releaseDate: number;
}

let _browser: Browser;
const handler: Route['handler'] = async (ctx) => {
    const baseUrl = 'https://www.binance.com';
    const language = 'en';
    const announcementCategoryUrl = `${baseUrl}/${language}/support/announcement`;
    const { type } = ctx.req.param<'/binance/announcement/:type'>();

    const id = ROUTE_PARAMETERS_CATALOGID_MAPPING[type];
    const link = `${announcementCategoryUrl}/${type}?c=${id}&navId=${id}`;

    const item = (await cache.tryGet(`binance:announcement:${type}:${id}`, async () => {
        const articles = await ofetch<BNApiResult>('https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=10', {
            headers: {
                'User-Agent': randUserAgent('mac'),
            },
            timeout: 1.5 * 1000,
        })
            .then((e) => {
                const data = e.data;
                const catalog = data.catalogs.find((e) => e.catalogId === id);
                if (!catalog) {
                    throw new Error('not found');
                }
                return catalog.articles;
            })
            .catch(async (error) => {
                logger.error('get articles by api error', error);
                if (!_browser) {
                    _browser = await puppeteer();
                }
                _browser.close();
                const page = await _browser.newPage();
                await page.goto(link, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#__APP_DATA');
                const response = await page.content();
                logger.info('response', response);
                const $ = cheerio.load(response);
                const app_data = $('#__APP_DATA').text();
                logger.info('__APP_DATA', app_data);
                const appData = JSON.parse(app_data);
                const values = Object.values(appData.appState.loader.dataByRouteId as Record<string, object>);
                logger.info(values);
                const catalogDetail = values.find((value) => 'catalogDetail' in value)?.catalogDetail as {
                    catalogId: number;
                    catalogName: string;
                    articles: { code: string; title: string; releaseDate: string; type: number }[];
                };
                const articles = catalogDetail.articles;
                return articles;
            })
            .finally(() => {
                _browser?.close();
            });

        return articles;
    })) as { code: string; title: string; releaseDate: string; type: number }[];

    return {
        title: `Binance ${type}`,
        link,
        item: item.map((article) => ({
            title: article.title,
            description: article.title,
            guid: article.code,
            pubDate: parseDate(article.releaseDate),
            link: `${announcementCategoryUrl}/${article.code}`,
        })),
    };
};

export const route: Route = {
    path: '/announcement/:type',
    categories: ['finance', 'popular'],
    view: ViewType.Articles,
    example: '/binance/announcement/new-cryptocurrency-listing',
    parameters: {
        type: {
            description: 'Binance Announcement type',
            default: 'new-cryptocurrency-listing',
            options: [
                { value: 'new-cryptocurrency-listing', label: 'New Cryptocurrency Listing' },
                { value: 'latest-binance-news', label: 'Latest Binance News' },
                { value: 'latest-activities', label: 'Latest Activities' },
                { value: 'new-fiat-listings', label: 'New Fiat Listings' },
                { value: 'api-updates', label: 'API Updates' },
                { value: 'crypto-airdrop', label: 'Crypto Airdrop' },
                { value: 'wallet-maintenance-updates', label: 'Wallet Maintenance Updates' },
                { value: 'delisting', label: 'Delisting' },
            ],
        },
    },
    name: 'Announcement',
    description: `
Type category

 - new-cryptocurrency-listing => New Cryptocurrency Listing
 - latest-binance-news        => Latest Binance News
 - latest-activities          => Latest Activities
 - new-fiat-listings          => New Fiat Listings
 - api-updates                => API Updates
 - crypto-airdrop             => Crypto Airdrop
 - wallet-maintenance-updates => Wallet Maintenance Updates
 - delisting                  => Delisting
`,
    maintainers: ['enpitsulin', 'axylm'],
    handler,
};
