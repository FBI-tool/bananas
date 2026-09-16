import {
  createCommit,
  createGroup,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeMlsMessage,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  mlsExporter,
  nobleCryptoProvider,
  processPrivateMessage,
  processPublicMessage,
  type ClientState,
  type CiphersuiteImpl,
  type KeyPackage,
  type PrivateKeyPackage,
  type Welcome,
} from 'ts-mls'
import { decryptAead, deriveAesKey, encodeAad, encryptAead } from './aead'
import {
  bytesToHex,
  CIPHERSUITE,
  CRYPTO_PROTOCOL_VERSION,
  exporterLabel,
  fromBase64Url,
  toBase64Url,
  type AppDomain,
} from './constants'
import { ReplayCache, controlReplayKey } from './replay'

export type DeviceIdentity = {
  publicKey: Uint8Array
  privateKey: Uint8Array
  fingerprint: string
}

export type VerificationInfo = {
  roomId: string
  epoch: number
  fingerprint: string
  members: Array<{ peerId: string; fingerprint: string }>
  securityCode: string
}

export type EncryptedApplication = {
  epoch: number
  sender: string
  domain: AppDomain
  seq: number
  iv: string
  ciphertext: string
}

export type MediaStreamIdentity = {
  sender: string
  kind: 'screen' | 'camera' | 'audio'
  streamId: string
}

export type MlsCommitBundle = {
  welcome: Uint8Array | null
  commit: Uint8Array
}

const te = new TextEncoder()
const td = new TextDecoder()

const toB64 = (bytes: Uint8Array): string => toBase64Url(bytes)

const decodeWire = (bytes: Uint8Array) => decodeMlsMessage(bytes, 0)?.[0]

export class RoomCrypto {
  private cs: CiphersuiteImpl | null = null
  private state: ClientState | null = null
  private keyPackage: { publicPackage: KeyPackage; privatePackage: PrivateKeyPackage } | null = null
  private keys = new Map<string, CryptoKey>()
  private seq = 0
  private replay = new ReplayCache()
  private leafIndex = new Map<string, number>()
  roomId = ''
  localPeerId = ''
  epoch = 0
  fingerprint = ''
  private members = new Map<string, string>()

  isReady(): boolean {
    return this.state !== null && this.cs !== null
  }

  hasRemoteMembers(): boolean {
    return this.leafIndex.size > 1
  }

  async initSuite(): Promise<CiphersuiteImpl> {
    if (this.cs) return this.cs
    const suite = getCiphersuiteFromName(CIPHERSUITE)
    this.cs = await getCiphersuiteImpl(suite, nobleCryptoProvider)
    return this.cs
  }

  private async prepare(
    roomId: string,
    localPeerId: string,
    identity: DeviceIdentity,
  ): Promise<CiphersuiteImpl> {
    const cs = await this.initSuite()
    this.roomId = roomId
    this.localPeerId = localPeerId
    this.fingerprint = identity.fingerprint
    this.members.set(localPeerId, identity.fingerprint)
    const credential = { credentialType: 'basic' as const, identity: te.encode(localPeerId) }
    this.keyPackage = await generateKeyPackage(
      credential,
      defaultCapabilities(),
      defaultLifetime,
      [],
      cs,
    )
    return cs
  }

  async createRoom(roomId: string, localPeerId: string, identity: DeviceIdentity): Promise<void> {
    const cs = await this.prepare(roomId, localPeerId, identity)
    if (!this.keyPackage) throw new Error('key package missing')
    this.state = await createGroup(
      te.encode(roomId),
      this.keyPackage.publicPackage,
      this.keyPackage.privatePackage,
      [],
      cs,
    )
    this.epoch = Number(this.state.groupContext.epoch)
    this.keys.clear()
    this.reindexLeaves()
  }

  async prepareJoiner(
    roomId: string,
    localPeerId: string,
    identity: DeviceIdentity,
  ): Promise<void> {
    await this.prepare(roomId, localPeerId, identity)
  }

  async joinRoom(
    roomId: string,
    localPeerId: string,
    identity: DeviceIdentity,
    welcome: Welcome,
  ): Promise<void> {
    const cs = this.keyPackage
      ? await this.initSuite()
      : await this.prepare(roomId, localPeerId, identity)
    if (!this.keyPackage) throw new Error('key package missing')
    this.roomId = roomId
    this.localPeerId = localPeerId
    this.fingerprint = identity.fingerprint
    this.members.set(localPeerId, identity.fingerprint)
    this.state = await joinGroup(
      welcome,
      this.keyPackage.publicPackage,
      this.keyPackage.privatePackage,
      emptyPskIndex,
      cs,
    )
    this.epoch = Number(this.state.groupContext.epoch)
    this.keys.clear()
    this.reindexLeaves()
  }

  localKeyPackage(): KeyPackage | null {
    return this.keyPackage?.publicPackage ?? null
  }

  encodeKeyPackage(): Uint8Array | null {
    if (!this.keyPackage) return null
    return encodeMlsMessage({
      version: 'mls10',
      wireformat: 'mls_key_package',
      keyPackage: this.keyPackage.publicPackage,
    })
  }

  decodeKeyPackage(bytes: Uint8Array): KeyPackage | null {
    const msg = decodeWire(bytes)
    if (!msg || msg.wireformat !== 'mls_key_package') return null
    return msg.keyPackage
  }

  async addMember(
    keyPackage: KeyPackage,
    peerId: string,
    fingerprint: string,
  ): Promise<MlsCommitBundle | null> {
    if (!this.state || !this.cs) return null
    const result = await createCommit(
      { state: this.state, cipherSuite: this.cs, pskIndex: emptyPskIndex },
      {
        extraProposals: [{ proposalType: 'add', add: { keyPackage } }],
        ratchetTreeExtension: true,
      },
    )
    this.state = result.newState
    this.epoch = Number(this.state.groupContext.epoch)
    this.members.set(peerId, fingerprint)
    this.keys.clear()
    this.reindexLeaves()
    const commit = encodeMlsMessage(result.commit)
    const welcome = result.welcome
      ? encodeMlsMessage({ version: 'mls10', wireformat: 'mls_welcome', welcome: result.welcome })
      : null
    return { welcome, commit }
  }

  leafOf(peerId: string): number | undefined {
    return this.leafIndex.get(peerId)
  }

  async removeMember(peerId: string): Promise<Uint8Array | null> {
    if (!this.state || !this.cs) return null
    const removed = this.leafIndex.get(peerId)
    if (removed === undefined) return null
    const result = await createCommit(
      { state: this.state, cipherSuite: this.cs, pskIndex: emptyPskIndex },
      { extraProposals: [{ proposalType: 'remove', remove: { removed } }] },
    )
    this.state = result.newState
    this.epoch = Number(this.state.groupContext.epoch)
    this.members.delete(peerId)
    this.keys.clear()
    this.reindexLeaves()
    return encodeMlsMessage(result.commit)
  }

  async handleWelcome(welcome: Welcome): Promise<void> {
    if (!this.keyPackage || !this.cs) return
    this.state = await joinGroup(
      welcome,
      this.keyPackage.publicPackage,
      this.keyPackage.privatePackage,
      emptyPskIndex,
      this.cs,
    )
    this.epoch = Number(this.state.groupContext.epoch)
    this.keys.clear()
    this.reindexLeaves()
  }

  async handleHandshakeMessage(
    bytes: Uint8Array,
  ): Promise<'welcome' | 'commit' | 'key-package' | 'ignored'> {
    const msg = decodeWire(bytes)
    if (!msg) return 'ignored'
    if (msg.wireformat === 'mls_key_package') return 'key-package'
    if (msg.wireformat === 'mls_welcome') {
      await this.handleWelcome(msg.welcome)
      return 'welcome'
    }
    if (!this.state || !this.cs) return 'ignored'
    if (msg.wireformat === 'mls_public_message') {
      const result = await processPublicMessage(
        this.state,
        msg.publicMessage,
        emptyPskIndex,
        this.cs,
      )
      this.state = result.newState
      this.epoch = Number(this.state.groupContext.epoch)
      this.keys.clear()
      this.reindexLeaves()
      return 'commit'
    }
    if (msg.wireformat === 'mls_private_message') {
      const result = await processPrivateMessage(
        this.state,
        msg.privateMessage,
        emptyPskIndex,
        this.cs,
      )
      this.state = result.newState
      this.epoch = Number(this.state.groupContext.epoch)
      this.keys.clear()
      this.reindexLeaves()
      return 'commit'
    }
    return 'ignored'
  }

  private reindexLeaves(): void {
    this.leafIndex.clear()
    if (!this.state) return
    const tree = this.state.ratchetTree
    for (let i = 0; i * 2 < tree.length; i += 1) {
      const node = tree[2 * i]
      if (!node || node.nodeType !== 'leaf') continue
      const cred = node.leaf.credential
      if (cred.credentialType === 'basic') {
        this.leafIndex.set(td.decode(cred.identity), i)
      }
    }
  }

  private async appKey(domain: AppDomain): Promise<CryptoKey> {
    const cached = this.keys.get(domain)
    if (cached) return cached
    if (!this.state || !this.cs) throw new Error('room crypto is not ready')
    const raw = await mlsExporter(
      this.state.keySchedule.exporterSecret,
      exporterLabel(domain),
      te.encode(`${this.roomId}|${this.epoch}`),
      16,
      this.cs,
    )
    const key = await deriveAesKey(raw)
    this.keys.set(domain, key)
    return key
  }

  async encryptApplication(
    domain: AppDomain,
    plaintext: Uint8Array,
    sender = this.localPeerId,
  ): Promise<EncryptedApplication> {
    const key = await this.appKey(domain)
    const seq = ++this.seq
    const aad = encodeAad([CRYPTO_PROTOCOL_VERSION, this.roomId, this.epoch, sender, domain, seq])
    const { iv, ciphertext } = await encryptAead(key, plaintext, aad)
    return {
      epoch: this.epoch,
      sender,
      domain,
      seq,
      iv: toB64(iv),
      ciphertext: toB64(ciphertext),
    }
  }

  async decryptApplication(message: EncryptedApplication): Promise<Uint8Array> {
    if (message.epoch !== this.epoch) throw new Error('wrong epoch')
    const opId = `${message.domain}:${message.seq}`
    if (
      !this.replay.remember(
        controlReplayKey({
          epoch: message.epoch,
          sender: message.sender,
          opId,
          roomId: this.roomId,
        }),
      )
    ) {
      throw new Error('replayed application message')
    }
    const key = await this.appKey(message.domain)
    const aad = encodeAad([
      CRYPTO_PROTOCOL_VERSION,
      this.roomId,
      message.epoch,
      message.sender,
      message.domain,
      message.seq,
    ])
    return decryptAead(
      key,
      { iv: fromBase64Url(message.iv), ciphertext: fromBase64Url(message.ciphertext) },
      aad,
    )
  }

  async exportMediaKey(stream: MediaStreamIdentity): Promise<Uint8Array> {
    if (!this.state || !this.cs) throw new Error('room crypto is not ready')
    return mlsExporter(
      this.state.keySchedule.exporterSecret,
      exporterLabel('media', `${stream.kind}/${stream.sender}`),
      te.encode(
        `${this.roomId}|${this.epoch}|${stream.sender}|${stream.kind}|${CRYPTO_PROTOCOL_VERSION}`,
      ),
      16,
      this.cs,
    )
  }

  getVerificationInfo(): VerificationInfo {
    const securityCode = this.fingerprint.slice(0, 24).toUpperCase()
    return {
      roomId: this.roomId,
      epoch: this.epoch,
      fingerprint: this.fingerprint,
      members: [...this.members.entries()].map(([peerId, fingerprint]) => ({
        peerId,
        fingerprint,
      })),
      securityCode,
    }
  }

  rememberMember(peerId: string, fingerprint: string): void {
    this.members.set(peerId, fingerprint)
  }

  memberFingerprint(peerId: string): string | undefined {
    return this.members.get(peerId)
  }

  async dispose(): Promise<void> {
    this.state = null
    this.keyPackage = null
    this.keys.clear()
    this.replay.clear()
    this.leafIndex.clear()
    this.members.clear()
    this.epoch = 0
  }
}

export const fingerprintFromPublicKey = (publicKey: Uint8Array): string =>
  bytesToHex(publicKey).slice(0, 32)
