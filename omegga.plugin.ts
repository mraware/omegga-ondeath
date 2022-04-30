import OmeggaPlugin, { OL, PS, PC, PluginInterop } from './omegga';

type Config = { interval: number };
type Storage = { subscriberNames: string[], pawnDataCache: any };

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;
  subscribers: PluginInterop[];
  deathCheckInterval: NodeJS.Timer;
  clearPawnDataCacheInterval: NodeJS.Timer;
  deathTracker: String[] = [];
  pawnDataCache: Map<string, any>;

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;

    this.subscribers = [];
    this.pawnDataCache = new Map<string, any>();
  }

  async init() {
    const pawnDataCache = await this.store.get('pawnDataCache');
    this.pawnDataCache = pawnDataCache ? new Map(Object.entries(pawnDataCache)) : new Map<string, any>();

    const subscriberNames = await this.store.get("subscriberNames") || [];
    for (const subscriberName of subscriberNames) {
      await this.subscribe(subscriberName);
    }
    this.deathCheckInterval = setInterval(this.deathCheck, this.config.interval);
    this.clearPawnDataCacheInterval = setInterval(this.clearPawnDataCache, 60000);

    this.omegga.on('start', () => {
      this.pawnDataCache = new Map<string, any>();
    })
  }

  async stop() {
    clearInterval(this.deathCheckInterval);
    clearInterval(this.clearPawnDataCacheInterval);

    await this.store.set('pawnDataCache', Object.fromEntries(this.pawnDataCache));
  }

  subscribe = async (pluginName) => {
    if (!this.subscribers.find((subscriber) => subscriber.name === pluginName)) {
      const plugin = await this.omegga.getPlugin(pluginName);
      if (plugin) {
        console.log(`${pluginName} subscribing`)
        this.subscribers.push(
          await this.omegga.getPlugin(pluginName)
        );
      } else {
        console.log(`${pluginName} is not enabled, removing subscription`)
      }
    }
    await this.store.set("subscriberNames", this.subscribers.map(subscriber => subscriber.name));
  }

  unsubscribe = async (pluginName) => {
    console.log(`${pluginName} unsubscribing`)
    this.subscribers = this.subscribers.filter((subscriber) => !(subscriber.name === pluginName))
    await this.store.set("subscriberNames", this.subscribers.map(subscriber => subscriber.name));
  }

  deathCheck = async () => {
    if (this.subscribers.length > 0 && this.omegga.getPlayers().length > 0) {
      const pawnInfo = await this.getPawnInfo();
      if (pawnInfo) {
        const { controllers, deads } = pawnInfo;

        const deaths = [];
        const spawns = [];

        controllers.forEach(({ pawn, controller }) => {
          const pawnData = this.pawnDataCache.get(pawn);
          if (!pawnData) {
            const player = this.omegga.getPlayer(controller);
            if (player) {
              spawns.push({
                pawn,
                player
              })
              this.pawnDataCache.set(pawn, { pawn, controller, player, lastActive: Date.now() })
            }
          } else {
            this.pawnDataCache.set(pawn, { ...pawnData, lastActive: Date.now() })
          }
        })

        deads.forEach(({ pawn, dead }) => {
          const pawnData = this.pawnDataCache.get(pawn);
          if (pawnData) {
            if (dead && !pawnData.dead) {
              deaths.push({
                pawn: pawnData.pawn,
                player: pawnData.player
              })
            }
            this.pawnDataCache.set(pawn, { ...pawnData, dead, lastActive: Date.now() })
          }
        })

        deaths.forEach(death => {
          this.subscribers.forEach(subscriber => {
            subscriber.emitPlugin('death', death);
          })
        })
        spawns.forEach(spawn => {
          this.subscribers.forEach(subscriber => {
            subscriber.emitPlugin('spawn', spawn);
          })
        })
      }
    }
  }

  async getPawnInfo() {
    const pawnRegExp =
      /(?<index>\d+)\) BP_PlayerController_C .+?PersistentLevel\.(?<controller>BP_PlayerController_C_\d+)\.Pawn = (?:None|BP_FigureV2_C'.+?:PersistentLevel.(?<pawn>BP_FigureV2_C_\d+)')?$/;
    const deadFigureRegExp =
      /(?<index>\d+)\) BP_FigureV2_C .+?PersistentLevel\.(?<pawn>BP_FigureV2_C_\d+)\.bIsDead = (?<dead>(True|False))$/;

    let [pawns, deadFigures] = await Promise.all([
      this.omegga.watchLogChunk<RegExpMatchArray>(
        'GetAll BP_PlayerController_C Pawn',
        pawnRegExp,
        {
          first: 'index',
          timeoutDelay: 5000,
          afterMatchDelay: 250
        }
      ),
      this.omegga.watchLogChunk<RegExpMatchArray>(
        'GetAll BP_FigureV2_C bIsDead',
        deadFigureRegExp,
        {
          first: 'index',
          timeoutDelay: 5000,
          afterMatchDelay: 250
        }
      )
    ]);

    // these results are invalid
    for (let i = 0; i < pawns.length; i++) {
      const pawn = pawns[i]?.groups?.pawn
      if (pawn && !deadFigures.find(dead => pawn === dead?.groups?.pawn)) {
        return;
      }
    }

    return (
      {
        controllers: pawns.map((pawn) => ({
          pawn: pawn.groups.pawn,
          controller: pawn.groups.controller
        })),
        deads: deadFigures.map((deadFigure) => ({
          pawn: deadFigure.groups.pawn,
          dead: deadFigure.groups.dead === "True"
        }))
      }
    );
  }

  // need to delete old pawns that are no longer able to be fetched from memory
  clearPawnDataCache = () => {
    const now = Date.now()
    for (const key in this.pawnDataCache.keys()) {
      const pawnData = this.pawnDataCache[key];
      if (pawnData.lastActive < Date.now() - 60000) {
        this.pawnDataCache.delete(key);
      }
    }
  }

  async pluginEvent(event: string, from: string, ...args: any[]) {
    if (event === 'subscribe') {
      this.subscribe(from);
    }
    if (event === 'unsubscribe') {
      this.unsubscribe(from);
    }
  }
}