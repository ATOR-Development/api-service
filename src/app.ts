import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { body, validationResult } from 'express-validator';
import { VictoriaMetricsService } from './VictoriaMetricsService';
import { OnionooService, HardwareInfo } from './OnionooService';
import dotenv from 'dotenv';
import QueryString from 'qs';
import { H3Service } from './H3Service';
import { GeoLiteService } from './GeoLiteService';
dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors());
const PORT = process.env.PORT ?? 3000;
const vmService = new VictoriaMetricsService(process.env.VICTORIA_METRICS_ADDRESS as string);

const CLUSTER = process.env.CLUSTER ?? 'local';
const ENV = process.env.ENV ?? 'main';
const ONIONOO_INSTANCE = process.env.ONIONOO_INSTANCE ?? '10.1.244.1:9090';
const JOB = process.env.JOB ?? 'consulagentonionoo';

const ONIONOO_PROTOCOL = process.env.ONIONOO_PROTOCOL ?? 'http://';
const onionooService = new OnionooService(`${ONIONOO_PROTOCOL}${ONIONOO_INSTANCE}`);

const FROM = process.env.FROM ?? '-7d';
const TO = process.env.TO ?? 'now';
const INTERVAL = process.env.INTERVAL ?? '6h';

const TOTAL_RELAYS_METRIC = 'total_relays';
const TOTAL_OBSERVED_BANDWIDTH_METRIC = 'total_observed_bandwidth';
const AVERAGE_BANDWIDTH_RATE_METRIC = 'average_bandwidth_rate';

const resolution = Number(process.env.HEXAGON_RESOLUTION) ?? 4;
const h3Service = new H3Service(resolution);
const geoLiteService = new GeoLiteService();

app.get('/total-relays', async (req, res) => {
    await handleQueryRange(buildQuery(TOTAL_RELAYS_METRIC), req.query, res);
});

app.get('/total-observed-bandwidth', async (req, res) => {
    await handleQueryRange(buildQuery(TOTAL_OBSERVED_BANDWIDTH_METRIC), req.query, res);
});

app.get('/average-bandwidth-rate', async (req, res) => {
    await handleQueryRange(buildQuery(AVERAGE_BANDWIDTH_RATE_METRIC), req.query, res);
});

app.get('/total-relays-latest', async (req, res) => {
    await handleQuery(buildQuery(TOTAL_RELAYS_METRIC), res);
});

app.get('/total-observed-bandwidth-latest', async (req, res) => {
    await handleQuery(buildQuery(TOTAL_OBSERVED_BANDWIDTH_METRIC), res);
});

app.get('/average-bandwidth-rate-latest', async (req, res) => {
    await handleQuery(buildQuery(AVERAGE_BANDWIDTH_RATE_METRIC), res);
});

app.get('/relays/:fingerprint', async (req, res) => {
    try {
        const details = await onionooService.details();
        console.log('Details:', details);

        const foundRelay = details.relays.find((relay: { fingerprint: string; }) =>
            relay.fingerprint === req.params.fingerprint
        );
        console.log('Found relay:', foundRelay);

        if (foundRelay) {
            const relay = {
                nickname: foundRelay.nickname,
                fingerprint: foundRelay.fingerprint,
                running: foundRelay.running,
                consensus_weight: foundRelay.consensus_weight,
                observed_bandwidth: foundRelay.observed_bandwidth,
                measured: foundRelay.measured
            };
            console.log('Relay:', relay);
            return res.json(relay);
        } else {
            console.log("Relay not found");
            return res.status(404).send('Relay not found');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error querying Onionoo');
    }
});

app.get('/relays', async (req, res) => {
    try {
        const fingerprintsQuery = req.query.fingerprints as string | undefined;

        if (!fingerprintsQuery) {
            return res.status(400).send('Fingerprints are required');
        }

        const fingerprints = fingerprintsQuery.split(',');

        if (fingerprints.length === 0) {
            return res.status(400).send('Fingerprints are required');
        }

        const details = await onionooService.details();

        const foundRelays = details.relays.filter((relay: { fingerprint: string; }) =>
            fingerprints.includes(relay.fingerprint)
        );
        console.log('Found relays:', foundRelays);

        if (foundRelays.length > 0) {
            const relays = foundRelays.map((foundRelay : any) => ({
                nickname: foundRelay.nickname,
                fingerprint: foundRelay.fingerprint,
                running: foundRelay.running,
                consensus_weight: foundRelay.consensus_weight,
                observed_bandwidth: foundRelay.observed_bandwidth,
                measured: foundRelay.measured
            }));
            console.log('Result relays:', relays);
            return res.json(relays);
        } else {
            console.log("No relays found");
            return res.status(404).send('No relays found');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error querying Onionoo');
    }
});

app.get('/relay-map/', async (req, res) => {
    try {
        const details = await onionooService.details();

        const ipAddresses: string[] = details.relays.map((relay: any) => 
            relay.or_addresses[0].split(':')[0]
        );

        const geo = ipAddresses.filter(item => item!== null).map((ip) => geoLiteService.ipToGeo(ip));

        console.log("Geo items size:", geo.length);

        const hexes = geo
            .filter(ll => ll && ll.length >= 2) // Ensure ll is not null and has at least 2 elements
            .map((ll) => h3Service.geoToHex(ll![0], ll![1]));

        console.log("Hexes items size:", hexes.length);

        const map: Map<string, number> = new Map();

        hexes.forEach(value => {
            const count = map.get(value) || 0;
            map.set(value, count + 1);
        });
        
        const result: HexInfo[] = [];

        map.forEach((value, key) => {   
            result.push(
                new HexInfo(key, value, h3Service.hexToGeo(key), h3Service.hexToBoundary(key))
            );
        });

        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error querying relay map');
    }
});

const hardware_relay_validation_rules = [
    body('id').notEmpty().withMessage("id should not be empty"),
    body('company').notEmpty().withMessage("company should not be empty"),
    body('format').notEmpty().withMessage("format should not be empty"),
    body('wallet').notEmpty().withMessage("wallet should not be empty"),
    body('fingerprint').notEmpty().withMessage("fingerprint should not be empty"),
    body('nftid').notEmpty().withMessage("nftid should not be empty"),
    body('build').notEmpty().withMessage("build should not be empty"),
    body('flags').notEmpty().withMessage("flags should not be empty"),
    body('serNums').notEmpty().withMessage("serNums should not be empty"),
    body('serNums.*.type').notEmpty().withMessage("serNums.*.type should not be empty"),
    body('serNums.*.number').notEmpty().withMessage("serNums.*.number should not be empty"),
    body('pubKeys').notEmpty().withMessage("ID should not be empty"),
    body('pubKeys.*.type').notEmpty().withMessage("pubKeys.*.type should not be empty"),
    body('pubKeys.*.number').notEmpty().withMessage("pubKeys.*.number should not be empty"),
    body('certs').notEmpty().withMessage("certs should not be empty"),
    body('certs.*.type').notEmpty().withMessage("certs.*.type should not be empty"),
    body('certs.*.signature').notEmpty().withMessage("certs.*.signature should not be empty")
];

app.post('/hardware', hardware_relay_validation_rules, async (req: any, res: any) => {
    const hardwareInfo: HardwareInfo = req.body;
  
    console.log('Hardware info: ', hardwareInfo);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
  
    const updateHardwareInfo = await onionooService.updateHardwareInfo(hardwareInfo);

    res.status(200).send(updateHardwareInfo);
});

function buildQuery(metric: string): string {
    return `${metric}{cluster="${CLUSTER}", env="${ENV}", instance="${ONIONOO_INSTANCE}", job="${JOB}"}`;
}

async function handleQuery(query: string, res: any) {
    try {
        const vmRawData = await vmService.query(query);
        console.log('VM RAW DATA:', vmRawData);

        const mappedData = vmRawData.data.result.reduce((acc: any, item: any) => {
            acc[item.metric.status] = item.value[1];
            return acc;
        }, {});
        console.log('MAPPED DATA:', mappedData);

        res.json(mappedData);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error querying VictoriaMetrics');
    }
}

async function handleQueryRange(query: string, params: QueryString.ParsedQs, res: any) {
    try {
        const from = String(params.from ?? FROM);
        const to = String(params.to ?? TO);
        const interval = String(params.interval ?? INTERVAL);

        const vmRawData = await vmService.query_range(query, from, to, interval);
        console.log(vmRawData);

        const mappedData = vmRawData.data.result.reduce((acc: any, item: any) => {
            acc[item.metric.status] = item.values;
            return acc;
        }, {});
        console.log(mappedData);

        res.json(mappedData);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error querying VictoriaMetrics');
    }
}

class HexInfo {
    constructor(
        public index: string,
        public relayCount: number,
        public geo: number[],
        public boundary: number[][]
    ) {}
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

export { app };
