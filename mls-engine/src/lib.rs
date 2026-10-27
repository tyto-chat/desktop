use std::sync::{Arc, Mutex};
use std::time::Duration;

use js_sys::Array;
use mls_rs::client_builder::{BaseConfig, WithCryptoProvider, WithIdentityProvider, WithMlsRules};
use mls_rs::error::{IntoAnyError, MlsError};
use mls_rs::extension::built_in::RatchetTreeExt;
use mls_rs::extension::recommended::LastResortKeyPackageExt;
use mls_rs::extension::MlsCodecExtension;
use mls_rs::group::{CommitEffect, Member, ReceivedMessage};
use mls_rs::identity::basic::BasicCredential;
use mls_rs::identity::{Credential as MlsCredential, CredentialType, SigningIdentity};
use mls_rs_core::identity::MemberValidationContext;
use mls_rs::mls_rules::{CommitOptions, DefaultMlsRules};
use mls_rs::time::MlsTime;
use mls_rs::{CipherSuite, CipherSuiteProvider, Client, CryptoProvider, ExtensionList, Group, MlsMessage};
use mls_rs_codec::{MlsDecode, MlsEncode, MlsSize};
use mls_rs_core::crypto::{SignaturePublicKey, SignatureSecretKey};
use mls_rs_core::group::{EpochRecord, GroupState, GroupStateStorage};
use mls_rs_core::key_package::{KeyPackageData, KeyPackageStorage};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

const CIPHER_SUITE: CipherSuite = CipherSuite::CURVE25519_AES128;
const MAX_EPOCHS: usize = 3;

type Config = WithIdentityProvider<
    TytoIdentityProvider,
    WithMlsRules<DefaultMlsRules, WithCryptoProvider<RustCryptoProvider, BaseConfig>>,
>;

#[derive(Debug)]
pub struct EngineError(String);

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for EngineError {}

impl IntoAnyError for EngineError {}

fn fail(message: impl Into<String>) -> JsError {
    JsError::new(&message.into())
}

fn mls(error: MlsError) -> JsError {
    JsError::new(&format!("mls: {error}"))
}

#[derive(Clone, Debug, PartialEq, Eq, MlsEncode, MlsDecode, MlsSize)]
struct TytoCredential {
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    server: Vec<u8>,
    account_id: u64,
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    device_id: Vec<u8>,
    generation: u64,
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    device_public_key: Vec<u8>,
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    signature: Vec<u8>,
}

impl TytoCredential {
    fn from_signing_identity(identity: &SigningIdentity) -> Result<Self, EngineError> {
        let MlsCredential::Basic(BasicCredential { identifier }) = &identity.credential else {
            return Err(EngineError("credential is not a tyto credential".into()));
        };
        let credential = Self::mls_decode(&mut identifier.as_slice()).map_err(|_| EngineError("credential does not decode".into()))?;
        if credential.device_public_key != identity.signature_key.as_bytes() {
            return Err(EngineError("credential is not bound to the leaf signature key".into()));
        }
        Ok(credential)
    }

    fn signing_identity(&self) -> Result<SigningIdentity, JsError> {
        let identifier = self.mls_encode_to_vec().map_err(|e| fail(format!("credential: {e}")))?;
        Ok(SigningIdentity::new(
            MlsCredential::Basic(BasicCredential::new(identifier)),
            SignaturePublicKey::new(self.device_public_key.clone()),
        ))
    }

    fn identity_bytes(&self) -> Vec<u8> {
        let mut out = self.server.clone();
        out.push(0);
        out.extend_from_slice(&self.account_id.to_be_bytes());
        out.extend_from_slice(&self.device_id);
        out
    }
}

#[derive(Clone, Default)]
struct TytoIdentityProvider;

impl mls_rs::IdentityProvider for TytoIdentityProvider {
    type Error = EngineError;

    fn validate_member(&self, signing_identity: &SigningIdentity, _: Option<MlsTime>, _: MemberValidationContext<'_>) -> Result<(), EngineError> {
        TytoCredential::from_signing_identity(signing_identity).map(|_| ())
    }

    fn validate_external_sender(&self, _: &SigningIdentity, _: Option<MlsTime>, _: Option<&ExtensionList>) -> Result<(), EngineError> {
        Err(EngineError("external senders are not allowed".into()))
    }

    fn identity(&self, signing_identity: &SigningIdentity, _: &ExtensionList) -> Result<Vec<u8>, EngineError> {
        Ok(TytoCredential::from_signing_identity(signing_identity)?.identity_bytes())
    }

    fn valid_successor(&self, predecessor: &SigningIdentity, successor: &SigningIdentity, _: &ExtensionList) -> Result<bool, EngineError> {
        Ok(TytoCredential::from_signing_identity(predecessor)?.identity_bytes() == TytoCredential::from_signing_identity(successor)?.identity_bytes())
    }

    fn supported_types(&self) -> Vec<CredentialType> {
        vec![BasicCredential::credential_type()]
    }
}

#[derive(Clone, MlsEncode, MlsDecode, MlsSize)]
struct StoredKeyPackage {
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    id: Vec<u8>,
    data: KeyPackageData,
}

#[derive(Clone, Default, MlsEncode, MlsDecode, MlsSize)]
struct StoredEpoch {
    id: u64,
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    data: Vec<u8>,
}

#[derive(Clone, Default, MlsEncode, MlsDecode, MlsSize)]
struct StoredGroup {
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    id: Vec<u8>,
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    state: Vec<u8>,
    epochs: Vec<StoredEpoch>,
    epoch: u64,
    version: u64,
}

#[derive(Clone, MlsEncode, MlsDecode, MlsSize)]
struct KeyPackageRef {
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    id: Vec<u8>,
}

#[derive(Clone, MlsEncode, MlsDecode, MlsSize)]
struct GroupDelta {
    #[mls_codec(with = "mls_rs_codec::byte_vec")]
    group_id: Vec<u8>,
    has_base: bool,
    base_version: u64,
    removed: bool,
    group: StoredGroup,
    consumed: Vec<KeyPackageRef>,
}

struct Base {
    version: Option<u64>,
    key_packages: Vec<Vec<u8>>,
}

#[derive(Clone, Default, MlsEncode, MlsDecode, MlsSize)]
struct DeviceState {
    version: u8,
    credential: TytoCredential,
    key_packages: Vec<StoredKeyPackage>,
    groups: Vec<StoredGroup>,
}

impl Default for TytoCredential {
    fn default() -> Self {
        Self { server: vec![], account_id: 0, device_id: vec![], generation: 0, device_public_key: vec![], signature: vec![] }
    }
}

#[derive(Clone)]
struct Store(Arc<Mutex<DeviceState>>);

impl Store {
    fn decode(bytes: &[u8]) -> Result<Self, JsError> {
        let state = DeviceState::mls_decode(&mut &*bytes).map_err(|_| fail("device state does not decode"))?;
        if state.version != 1 {
            return Err(fail("unsupported device state version"));
        }
        Ok(Self(Arc::new(Mutex::new(state))))
    }

    fn encode(&self) -> Result<Vec<u8>, JsError> {
        self.0.lock().unwrap().mls_encode_to_vec().map_err(|e| fail(format!("state: {e}")))
    }

    fn credential(&self) -> TytoCredential {
        self.0.lock().unwrap().credential.clone()
    }

    fn base(&self, group_id: Option<&[u8]>) -> Base {
        let device = self.0.lock().unwrap();
        Base {
            version: group_id.and_then(|id| device.groups.iter().find(|g| g.id == id).map(|g| g.version)),
            key_packages: device.key_packages.iter().map(|p| p.id.clone()).collect(),
        }
    }

    fn set_epoch(&self, group_id: &[u8], epoch: u64) {
        if let Some(group) = self.0.lock().unwrap().groups.iter_mut().find(|g| g.id == group_id) {
            group.epoch = epoch;
        }
    }

    fn delta(&self, group_id: &[u8], base: &Base, removed: bool) -> Result<Vec<u8>, JsError> {
        let device = self.0.lock().unwrap();
        let group = if removed {
            StoredGroup::default()
        } else {
            device.groups.iter().find(|g| g.id == group_id).cloned().ok_or_else(|| fail("group not stored"))?
        };
        let consumed = base
            .key_packages
            .iter()
            .filter(|id| !device.key_packages.iter().any(|p| &p.id == *id))
            .map(|id| KeyPackageRef { id: id.clone() })
            .collect();
        GroupDelta {
            group_id: group_id.to_vec(),
            has_base: base.version.is_some(),
            base_version: base.version.unwrap_or(0),
            removed,
            group,
            consumed,
        }
        .mls_encode_to_vec()
        .map_err(|e| fail(format!("delta: {e}")))
    }
}

impl KeyPackageStorage for Store {
    type Error = EngineError;

    fn delete(&mut self, id: &[u8]) -> Result<(), EngineError> {
        self.0.lock().unwrap().key_packages.retain(|p| p.id != id);
        Ok(())
    }

    fn insert(&mut self, id: Vec<u8>, data: KeyPackageData) -> Result<(), EngineError> {
        let mut state = self.0.lock().unwrap();
        state.key_packages.retain(|p| p.id != id);
        state.key_packages.push(StoredKeyPackage { id, data });
        Ok(())
    }

    fn get(&self, id: &[u8]) -> Result<Option<KeyPackageData>, EngineError> {
        Ok(self.0.lock().unwrap().key_packages.iter().find(|p| p.id == id).map(|p| p.data.clone()))
    }
}

impl GroupStateStorage for Store {
    type Error = EngineError;

    fn state(&self, group_id: &[u8]) -> Result<Option<Zeroizing<Vec<u8>>>, EngineError> {
        Ok(self.0.lock().unwrap().groups.iter().find(|g| g.id == group_id).map(|g| Zeroizing::new(g.state.clone())))
    }

    fn epoch(&self, group_id: &[u8], epoch_id: u64) -> Result<Option<Zeroizing<Vec<u8>>>, EngineError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .groups
            .iter()
            .find(|g| g.id == group_id)
            .and_then(|g| g.epochs.iter().find(|e| e.id == epoch_id))
            .map(|e| Zeroizing::new(e.data.clone())))
    }

    fn write(&mut self, state: GroupState, inserts: Vec<EpochRecord>, updates: Vec<EpochRecord>) -> Result<(), EngineError> {
        let mut device = self.0.lock().unwrap();
        let index = match device.groups.iter().position(|g| g.id == state.id) {
            Some(index) => index,
            None => {
                device.groups.push(StoredGroup { id: state.id.clone(), ..Default::default() });
                device.groups.len() - 1
            }
        };
        let group = &mut device.groups[index];
        group.version += 1;
        group.state = state.data.to_vec();
        for update in updates {
            if let Some(epoch) = group.epochs.iter_mut().find(|e| e.id == update.id) {
                epoch.data = update.data.to_vec();
            }
        }
        for insert in inserts {
            group.epochs.retain(|e| e.id != insert.id);
            group.epochs.push(StoredEpoch { id: insert.id, data: insert.data.to_vec() });
        }
        group.epochs.sort_by_key(|e| e.id);
        let excess = group.epochs.len().saturating_sub(MAX_EPOCHS);
        group.epochs.drain(..excess);
        Ok(())
    }

    fn max_epoch_id(&self, group_id: &[u8]) -> Result<Option<u64>, EngineError> {
        Ok(self.0.lock().unwrap().groups.iter().find(|g| g.id == group_id).and_then(|g| g.epochs.iter().map(|e| e.id).max()))
    }
}

fn client(store: &Store, signer: &[u8], lifetime: Option<u64>) -> Result<Client<impl mls_rs::client_builder::MlsConfig>, JsError> {
    let credential = store.credential();
    let mut builder = Client::builder()
        .crypto_provider(RustCryptoProvider::new())
        .mls_rules(DefaultMlsRules::new().with_commit_options(CommitOptions::new().with_ratchet_tree_extension(true).with_allow_external_commit(true).with_path_required(true)))
        .identity_provider(TytoIdentityProvider)
        .extension_type(LastResortKeyPackageExt::extension_type())
        .key_package_repo(store.clone())
        .group_state_storage(store.clone())
        .signing_identity(credential.signing_identity()?, SignatureSecretKey::new(signer.to_vec()), CIPHER_SUITE);
    if let Some(seconds) = lifetime {
        builder = builder.key_package_lifetime(Duration::from_secs(seconds));
    }
    Ok(builder.build())
}

fn suite() -> Result<impl CipherSuiteProvider, JsError> {
    RustCryptoProvider::new().cipher_suite_provider(CIPHER_SUITE).ok_or_else(|| fail("cipher suite unavailable"))
}

fn message(bytes: &[u8]) -> Result<MlsMessage, JsError> {
    MlsMessage::from_bytes(bytes).map_err(mls)
}

fn bytes(message: &MlsMessage) -> Result<Vec<u8>, JsError> {
    message.to_bytes().map_err(mls)
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone)]
pub struct Credential {
    pub server: String,
    #[wasm_bindgen(js_name = accountId)]
    pub account_id: f64,
    #[wasm_bindgen(js_name = deviceId)]
    pub device_id: String,
    pub generation: f64,
    #[wasm_bindgen(js_name = devicePublicKey)]
    pub device_public_key: Vec<u8>,
    pub signature: Vec<u8>,
}

#[wasm_bindgen]
impl Credential {
    #[wasm_bindgen(constructor)]
    pub fn new(server: String, account_id: f64, device_id: String, generation: f64, device_public_key: Vec<u8>, signature: Vec<u8>) -> Credential {
        Credential { server, account_id, device_id, generation, device_public_key, signature }
    }
}

impl Credential {
    fn from_tyto(c: &TytoCredential) -> Credential {
        Credential {
            server: String::from_utf8_lossy(&c.server).into_owned(),
            account_id: c.account_id as f64,
            device_id: String::from_utf8_lossy(&c.device_id).into_owned(),
            generation: c.generation as f64,
            device_public_key: c.device_public_key.clone(),
            signature: c.signature.clone(),
        }
    }

    fn to_tyto(&self) -> Result<TytoCredential, JsError> {
        let whole = |v: f64, name: &str| {
            if v.fract() != 0.0 || !(0.0..=9_007_199_254_740_991.0).contains(&v) {
                Err(fail(format!("{name} must be a non-negative integer")))
            } else {
                Ok(v as u64)
            }
        };
        Ok(TytoCredential {
            server: self.server.as_bytes().to_vec(),
            account_id: whole(self.account_id, "accountId")?,
            device_id: self.device_id.as_bytes().to_vec(),
            generation: whole(self.generation, "generation")?,
            device_public_key: self.device_public_key.clone(),
            signature: self.signature.clone(),
        })
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone)]
pub struct MemberInfo {
    pub credential: Credential,
    #[wasm_bindgen(js_name = leafIndex)]
    pub leaf_index: u32,
}

fn member_info(member: &Member) -> Result<MemberInfo, JsError> {
    let credential = TytoCredential::from_signing_identity(&member.signing_identity).map_err(|e| fail(e.0))?;
    Ok(MemberInfo { credential: Credential::from_tyto(&credential), leaf_index: member.index })
}

fn roster<C: mls_rs::client_builder::MlsConfig>(group: &Group<C>) -> Result<Vec<MemberInfo>, JsError> {
    group.roster().members().iter().map(member_info).collect()
}

fn same_member(a: &MemberInfo, b: &MemberInfo) -> bool {
    a.leaf_index == b.leaf_index && a.credential.device_public_key == b.credential.device_public_key && a.credential.device_id == b.credential.device_id
}

fn difference(left: &[MemberInfo], right: &[MemberInfo]) -> Vec<MemberInfo> {
    left.iter().filter(|m| !right.iter().any(|o| same_member(m, o))).cloned().collect()
}

#[wasm_bindgen(getter_with_clone)]
pub struct Staged {
    pub state: Vec<u8>,
    #[wasm_bindgen(js_name = groupId)]
    pub group_id: Vec<u8>,
    pub commit: Option<Vec<u8>>,
    #[wasm_bindgen(js_name = groupInfo)]
    pub group_info: Option<Vec<u8>>,
    pub actor: Credential,
    pub added: Vec<MemberInfo>,
    pub removed: Vec<MemberInfo>,
    #[wasm_bindgen(js_name = resultingRoster)]
    pub resulting_roster: Vec<MemberInfo>,
    #[wasm_bindgen(js_name = newEpoch)]
    pub new_epoch: f64,
    welcomes: Vec<Vec<u8>>,
}

#[wasm_bindgen]
impl Staged {
    #[wasm_bindgen(getter)]
    pub fn welcomes(&self) -> Array {
        self.welcomes.iter().map(|w| js_sys::Uint8Array::from(w.as_slice())).collect()
    }
}

#[allow(clippy::too_many_arguments)]
fn staged<C: mls_rs::client_builder::MlsConfig>(
    store: &Store,
    base: &Base,
    group: &mut Group<C>,
    before: &[MemberInfo],
    commit: Option<Vec<u8>>,
    actor: Credential,
    welcomes: Vec<Vec<u8>>,
    with_group_info: bool,
) -> Result<Staged, JsError> {
    group.write_to_storage().map_err(mls)?;
    store.set_epoch(group.group_id(), group.current_epoch());
    let after = roster(group)?;
    let group_info = if with_group_info { Some(bytes(&group.group_info_message_allowing_ext_commit(true).map_err(mls)?)?) } else { None };
    Ok(Staged {
        state: store.delta(group.group_id(), base, false)?,
        group_id: group.group_id().to_vec(),
        commit,
        group_info,
        actor,
        added: difference(&after, before),
        removed: difference(before, &after),
        resulting_roster: after,
        new_epoch: group.current_epoch() as f64,
        welcomes,
    })
}

#[wasm_bindgen(getter_with_clone)]
pub struct KeyPair {
    pub secret: Vec<u8>,
    pub public: Vec<u8>,
}

#[wasm_bindgen(js_name = generateSignatureKeyPair)]
pub fn generate_signature_key_pair() -> Result<KeyPair, JsError> {
    let (secret, public) = suite()?.signature_key_generate().map_err(|e| fail(format!("keygen: {e:?}")))?;
    Ok(KeyPair { secret: secret.as_bytes().to_vec(), public: public.as_bytes().to_vec() })
}

#[wasm_bindgen(js_name = publicKeyOf)]
pub fn public_key_of(secret: &[u8]) -> Result<Vec<u8>, JsError> {
    let public = suite()?.signature_key_derive_public(&SignatureSecretKey::new(secret.to_vec())).map_err(|e| fail(format!("derive: {e:?}")))?;
    Ok(public.as_bytes().to_vec())
}

#[wasm_bindgen(js_name = signDetached)]
pub fn sign_detached(secret: &[u8], data: &[u8]) -> Result<Vec<u8>, JsError> {
    suite()?.sign(&SignatureSecretKey::new(secret.to_vec()), data).map_err(|e| fail(format!("sign: {e:?}")))
}

#[wasm_bindgen(js_name = generateDevice)]
pub fn generate_device(credential: &Credential, signer: &[u8]) -> Result<Vec<u8>, JsError> {
    let credential = credential.to_tyto()?;
    if public_key_of(signer)? != credential.device_public_key {
        return Err(fail("credential does not match the device signing key"));
    }
    let state = DeviceState { version: 1, credential, key_packages: vec![], groups: vec![] };
    state.mls_encode_to_vec().map_err(|e| fail(format!("state: {e}")))
}

#[wasm_bindgen(getter_with_clone)]
pub struct KeyPackages {
    pub state: Vec<u8>,
    #[wasm_bindgen(js_name = lastResort)]
    pub last_resort: Vec<u8>,
    packages: Vec<Vec<u8>>,
}

#[wasm_bindgen]
impl KeyPackages {
    #[wasm_bindgen(getter)]
    pub fn packages(&self) -> Array {
        self.packages.iter().map(|p| js_sys::Uint8Array::from(p.as_slice())).collect()
    }
}

#[wasm_bindgen(js_name = createKeyPackages)]
pub fn create_key_packages(state: &[u8], signer: &[u8], count: u32, lifetime_seconds: u32) -> Result<KeyPackages, JsError> {
    let store = Store::decode(state)?;
    let client = client(&store, signer, Some(lifetime_seconds as u64))?;
    let mut packages = Vec::with_capacity(count as usize);
    for _ in 0..count {
        packages.push(bytes(&client.generate_key_package_message(ExtensionList::new(), ExtensionList::new(), None).map_err(mls)?)?);
    }
    let mut last_resort_extensions = ExtensionList::new();
    last_resort_extensions.set_from(LastResortKeyPackageExt).map_err(|e| fail(format!("extension: {e}")))?;
    let last_resort = bytes(&client.generate_key_package_message(last_resort_extensions, ExtensionList::new(), None).map_err(mls)?)?;
    Ok(KeyPackages { state: store.encode()?, last_resort, packages })
}

#[wasm_bindgen(js_name = inspectKeyPackage)]
pub fn inspect_key_package(key_package: &[u8]) -> Result<Credential, JsError> {
    let message = message(key_package)?;
    let package = message.as_key_package().ok_or_else(|| fail("not a key package"))?;
    let credential = TytoCredential::from_signing_identity(package.signing_identity()).map_err(|e| fail(e.0))?;
    Ok(Credential::from_tyto(&credential))
}

#[wasm_bindgen(getter_with_clone)]
pub struct GroupInfoSummary {
    #[wasm_bindgen(js_name = groupId)]
    pub group_id: Vec<u8>,
    pub epoch: f64,
    pub members: Vec<MemberInfo>,
}

#[wasm_bindgen(js_name = inspectGroupInfo)]
pub fn inspect_group_info(group_info: &[u8]) -> Result<GroupInfoSummary, JsError> {
    let message = message(group_info)?;
    let info = message.as_group_info().ok_or_else(|| fail("not a group info"))?;
    let tree = info.extensions().get_as::<RatchetTreeExt>().map_err(|e| fail(format!("tree: {e}")))?.ok_or_else(|| fail("group info carries no ratchet tree"))?;
    let members = tree
        .tree_data
        .roster()
        .members()
        .iter()
        .map(member_info)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(GroupInfoSummary { group_id: info.group_context().group_id().to_vec(), epoch: info.group_context().epoch() as f64, members })
}

#[wasm_bindgen(js_name = createGroup)]
pub fn create_group(state: &[u8], signer: &[u8], group_id: &[u8]) -> Result<Staged, JsError> {
    let store = Store::decode(state)?;
    if store.0.lock().unwrap().groups.iter().any(|g| g.id == group_id) {
        return Err(fail("group already exists"));
    }
    let base = store.base(Some(group_id));
    let client = client(&store, signer, None)?;
    let mut group = client.create_group_with_id(group_id.to_vec(), ExtensionList::new(), ExtensionList::new(), None).map_err(mls)?;
    let actor = Credential::from_tyto(&store.credential());
    staged(&store, &base, &mut group, &[], None, actor, vec![], true)
}

fn refuse_existing(store: &Store, group_id: &[u8]) -> Result<(), JsError> {
    if store.0.lock().unwrap().groups.iter().any(|g| g.id == group_id) {
        return Err(fail("this device is already in the conversation"));
    }
    Ok(())
}

fn load<C: mls_rs::client_builder::MlsConfig>(client: &Client<C>, group_id: &[u8]) -> Result<Group<C>, JsError> {
    client.load_group(group_id).map_err(mls)
}

#[wasm_bindgen(js_name = addMembers)]
pub fn add_members(state: &[u8], signer: &[u8], group_id: &[u8], key_packages: Vec<js_sys::Uint8Array>) -> Result<Staged, JsError> {
    let store = Store::decode(state)?;
    let base = store.base(Some(group_id));
    let client = client(&store, signer, None)?;
    let mut group = load(&client, group_id)?;
    let before = roster(&group)?;
    let mut builder = group.commit_builder();
    for package in key_packages {
        builder = builder.add_member(message(&package.to_vec())?).map_err(mls)?;
    }
    let output = builder.build().map_err(mls)?;
    group.apply_pending_commit().map_err(mls)?;
    let welcomes = output.welcome_messages().iter().map(bytes).collect::<Result<Vec<_>, _>>()?;
    let actor = Credential::from_tyto(&store.credential());
    staged(&store, &base, &mut group, &before, Some(bytes(output.commit_message())?), actor, welcomes, true)
}

#[wasm_bindgen(js_name = removeMember)]
pub fn remove_member(state: &[u8], signer: &[u8], group_id: &[u8], leaf_index: u32) -> Result<Staged, JsError> {
    let store = Store::decode(state)?;
    let base = store.base(Some(group_id));
    let client = client(&store, signer, None)?;
    let mut group = load(&client, group_id)?;
    let before = roster(&group)?;
    let output = group.commit_builder().remove_member(leaf_index).map_err(mls)?.build().map_err(mls)?;
    group.apply_pending_commit().map_err(mls)?;
    let actor = Credential::from_tyto(&store.credential());
    staged(&store, &base, &mut group, &before, Some(bytes(output.commit_message())?), actor, vec![], true)
}

#[wasm_bindgen(js_name = joinFromWelcome)]
pub fn join_from_welcome(state: &[u8], signer: &[u8], welcome: &[u8]) -> Result<Staged, JsError> {
    let store = Store::decode(state)?;
    let base = store.base(None);
    let client = client(&store, signer, None)?;
    let (mut group, info) = client.join_group(None, &message(welcome)?, None).map_err(mls)?;
    refuse_existing(&store, group.group_id())?;
    let actor = member_info(&group.roster().member_with_index(info.sender).map_err(mls)?)?.credential;
    staged(&store, &base, &mut group, &[], None, actor, vec![], false)
}

#[wasm_bindgen(js_name = joinExternal)]
pub fn join_external(state: &[u8], signer: &[u8], group_info: &[u8]) -> Result<Staged, JsError> {
    let store = Store::decode(state)?;
    let client = client(&store, signer, None)?;
    let summary = inspect_group_info(group_info)?;
    refuse_existing(&store, &summary.group_id)?;
    let base = store.base(None);
    let (mut group, commit) = client.external_commit_builder().map_err(mls)?.build(message(group_info)?).map_err(mls)?;
    let actor = Credential::from_tyto(&store.credential());
    staged(&store, &base, &mut group, &[], Some(bytes(&commit)?), actor, vec![], true)
}

#[wasm_bindgen(js_name = stageIncomingCommit)]
pub fn stage_incoming_commit(state: &[u8], signer: &[u8], group_id: &[u8], commit: &[u8]) -> Result<Staged, JsError> {
    let store = Store::decode(state)?;
    let base = store.base(Some(group_id));
    let client = client(&store, signer, None)?;
    let mut group = load(&client, group_id)?;
    let before_members = group.roster().members();
    let before = roster(&group)?;
    let ReceivedMessage::Commit(description) = group.process_incoming_message(message(commit)?).map_err(mls)? else {
        return Err(fail("message is not a commit"));
    };
    let committer = if description.is_external {
        group.roster().member_with_index(description.committer).map_err(mls)?
    } else {
        before_members.into_iter().find(|m| m.index == description.committer).ok_or_else(|| fail("committer not in roster"))?
    };
    let actor = member_info(&committer)?.credential;
    match description.effect {
        CommitEffect::NewEpoch(_) => staged(&store, &base, &mut group, &before, None, actor, vec![], false),
        CommitEffect::Removed { new_epoch, .. } => {
            let own = group.current_member_index();
            store.0.lock().unwrap().groups.retain(|g| g.id != group_id);
            Ok(Staged {
                state: store.delta(group_id, &base, true)?,
                group_id: group_id.to_vec(),
                commit: None,
                group_info: None,
                actor,
                added: vec![],
                removed: before.iter().filter(|m| m.leaf_index == own).cloned().collect(),
                resulting_roster: before.iter().filter(|m| m.leaf_index != own).cloned().collect(),
                new_epoch: new_epoch.epoch as f64,
                welcomes: vec![],
            })
        }
        CommitEffect::ReInit(_) => Err(fail("reinit is not supported")),
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct Encrypted {
    pub state: Vec<u8>,
    pub message: Vec<u8>,
}

#[wasm_bindgen]
pub fn encrypt(state: &[u8], signer: &[u8], group_id: &[u8], data: &[u8]) -> Result<Encrypted, JsError> {
    let store = Store::decode(state)?;
    let client = client(&store, signer, None)?;
    let mut group = load(&client, group_id)?;
    let message = group.encrypt_application_message(data, vec![]).map_err(mls)?;
    group.write_to_storage().map_err(mls)?;
    store.set_epoch(group_id, group.current_epoch());
    Ok(Encrypted { state: store.encode()?, message: bytes(&message)? })
}

#[wasm_bindgen(getter_with_clone)]
pub struct Decrypted {
    pub state: Vec<u8>,
    pub data: Vec<u8>,
    pub sender: Credential,
}

#[wasm_bindgen]
pub fn decrypt(state: &[u8], signer: &[u8], group_id: &[u8], ciphertext: &[u8]) -> Result<Decrypted, JsError> {
    let store = Store::decode(state)?;
    let client = client(&store, signer, None)?;
    let mut group = load(&client, group_id)?;
    let ReceivedMessage::ApplicationMessage(description) = group.process_incoming_message(message(ciphertext)?).map_err(mls)? else {
        return Err(fail("message is not an application message"));
    };
    let sender = member_info(&group.roster().member_with_index(description.sender_index).map_err(mls)?)?.credential;
    group.write_to_storage().map_err(mls)?;
    store.set_epoch(group_id, group.current_epoch());
    Ok(Decrypted { state: store.encode()?, data: description.data().to_vec(), sender })
}

#[wasm_bindgen(js_name = applyDelta)]
pub fn apply_delta(state: &[u8], delta: &[u8]) -> Result<Vec<u8>, JsError> {
    let store = Store::decode(state)?;
    let delta = GroupDelta::mls_decode(&mut &*delta).map_err(|_| fail("stage does not decode"))?;
    {
        let mut device = store.0.lock().unwrap();
        let index = device.groups.iter().position(|g| g.id == delta.group_id);
        match (index, delta.has_base) {
            (None, false) => {}
            (Some(i), true) if device.groups[i].version == delta.base_version => {}
            _ => return Err(fail("stale stage: the conversation changed since it was staged")),
        }
        if delta.consumed.iter().any(|c| !device.key_packages.iter().any(|p| p.id == c.id)) {
            return Err(fail("stale stage: its key package was already used"));
        }
        match (delta.removed, index) {
            (true, _) => device.groups.retain(|g| g.id != delta.group_id),
            (false, Some(i)) => device.groups[i] = delta.group,
            (false, None) => device.groups.push(delta.group),
        }
        device.key_packages.retain(|p| !delta.consumed.iter().any(|c| c.id == p.id));
    }
    store.encode()
}
