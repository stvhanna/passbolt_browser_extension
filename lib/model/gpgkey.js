var openpgp = require("openpgp");
var storage = new (require('node-localstorage').LocalStorage)();
var keyring = new openpgp.Keyring();

/**
 * The class that deals with Passbolt GPGkey.
 */
var Gpgkey = function() {
  this.keyring = new openpgp.Keyring();
  this.publicKeys = {};
  this.privateKeys = {};

  // Get the public keys from the local storage.
  var pubSerialized = storage.getItem('passbolt-public-gpgkeys');
  if (pubSerialized) {
    this.publicKeys = JSON.parse(pubSerialized);
  }

  // Get the private keys from the local storage.
  var pvtSerialized = storage.getItem('passbolt-private-gpgkeys');
  if (pvtSerialized) {
    this.privateKeys = JSON.parse(pvtSerialized);
  }
};

Gpgkey.PUBLIC_HEADER ='-----BEGIN PGP PUBLIC KEY BLOCK-----';
Gpgkey.PUBLIC_FOOTER = '-----END PGP PUBLIC KEY BLOCK-----';
Gpgkey.PRIVATE_HEADER = '-----BEGIN PGP PRIVATE KEY BLOCK-----';
Gpgkey.PRIVATE_FOOTER = '-----END PGP PRIVATE KEY BLOCK-----';
Gpgkey.PUBLIC = 'PUBLIC';
Gpgkey.PRIVATE = 'PRIVATE';

/**
 * store the gpgkeys in local storage.
 */
Gpgkey.prototype.store = function() {
  storage.setItem('passbolt-public-gpgkeys', JSON.stringify(this.publicKeys));
  storage.setItem('passbolt-private-gpgkeys', JSON.stringify(this.privateKeys));
};

/**
 * Flush the Keyring.
 * @param type The type of keys to flush (PUBLIC/PRIVATE). Default PUBLIC.
 */
Gpgkey.prototype.flush = function(type) {
  var type = type || Gpgkey.PUBLIC;

  if (type == Gpgkey.PUBLIC) {
    this.publicKeys = {};
  }
  else if (type == Gpgkey.PRIVATE) {
    this.privateKeys = {};
  }

  // Update the local storage.
  this.store();
};

/**
 * Parse an armored key and extract Public or Private sub string.
 * @param armoredKey The key to parse.
 * @param type Parse for PUBLIC or PRIVATE.
 * @returns {*|string}
 */
var parseArmoredKey = function(armoredKey, type) {
  // The type of key to parse. By default the PRIVATE.
  var type = type || Gpgkey.PRIVATE;
  // The parsed key. If no header found the output will be the input.
  var key = armoredKey || '';

  if (type == Gpgkey.PUBLIC) {
    // Check if we find the public header & footer.
    var pubHeaderPos = armoredKey.indexOf(Gpgkey.PUBLIC_HEADER);
    if (pubHeaderPos != -1) {
      var pubFooterPos = armoredKey.indexOf(Gpgkey.PUBLIC_FOOTER);
      if (pubFooterPos != -1) {
        key = armoredKey.substr(pubHeaderPos, pubFooterPos + Gpgkey.PUBLIC_FOOTER.length);
      }
    }
  } else if (type == Gpgkey.PRIVATE) {
    // Check if we find the private header & footer.
    var privHeaderPos = armoredKey.indexOf(Gpgkey.PRIVATE_HEADER);
    if (privHeaderPos != -1) {
      var privFooterPos = armoredKey.indexOf(Gpgkey.PRIVATE_FOOTER);
      if (privFooterPos != -1) {
        key = armoredKey.substr(privHeaderPos, privFooterPos + Gpgkey.PRIVATE_HEADER.length);
      }
    }
  }

  return key;
};

/**
 * Import a public key.
 * @param armoredKey The key to import.
 * @param meta The key meta information
 * @returns {Object|string} Return the openpgp key if imported with success.
 * Otherwise return an error string message.
 */
Gpgkey.prototype.importPublic = function (armoredKey, meta) {
  // Parse the keys. If standard format given with a text containing
  // public/private. It will extract only the public.
  var armoredKey = parseArmoredKey(armoredKey, Gpgkey.PUBLIC);

  // Is the given key a valid pgp key ?
  var openpgpRes = openpgp.key.readArmored(armoredKey);

  // Return the error in any case
  if (openpgpRes.err) {
    return openpgpRes.err[0].message;
  }
  var key = openpgpRes.keys[0];
  // If the key is not public, return an error.
  if (!key.isPublic()) {
    return 'Private key given';
  }

  this.publicKeys[meta.user_id] = meta;

  // Update the local storage.
  this.store();

  return true;
};

/**
 * Import a private key into the Keyring.
 * @param armoredKey The key to import.
 * @returns {Object|string} Return the openpgp key if imported with success.
 * Otherwise return an error string message.
 */
Gpgkey.prototype.importPrivate = function (armoredKey) {
  // Flush any existing private key.
  // @todo Less violence.
  this.flush(Gpgkey.PRIVATE);

  // Parse the keys. If standard format given with a text containing
  // public/private. It will extract only the private.
  var armoredKey = parseArmoredKey(armoredKey, Gpgkey.PRIVATE);

  // Is the given key a valid pgp key ?
  var openpgpRes = openpgp.key.readArmored(armoredKey);

  // Return the error in any case
  if (openpgpRes.err) {
    return openpgpRes.err[0].message;
  }
  var key = openpgpRes.keys[0];
  // If the key is not private, return an error.
  if (!key.isPrivate()) {
    return 'Public key given';
  }

  // Get the keyInfo.
  var keyInfo = this.keyInfo(armoredKey);

  this.privateKeys['MY_KEY_ID'] = keyInfo;

  // Update the local storage.
  this.store();

  return true;
};

/**
 * Get the key info.
 * @param armoredKey
 * @return {array} the key info.
 */
Gpgkey.prototype.keyInfo = function(armoredKey) {
  var openpgpRes = openpgp.key.readArmored(armoredKey),
    key = openpgpRes.keys[0],
    userIds = key.getUserIds(),
    userIdsSplited = [];

  // Extract name & email from key userIds.
  var myRegexp = /(.*) <(\S+@\S+)>$/g;
  for (var i in userIds) {
    var match = myRegexp.exec(userIds[i]);
    userIdsSplited.push({
      name: match[1],
      email: match[2]
    });
  }

  var info = {
    key: armoredKey,
    keyId: key.primaryKey.getKeyId().toHex(),
    userIds: userIdsSplited,
    fingerprint: key.primaryKey.getFingerprint(),
    algorithm: key.primaryKey.algorithm.substring(0, 3), //TODO : proper alghorithm parsing
    created: key.primaryKey.created,
    expires: key.getExpirationTime(),
    length: key.primaryKey.getBitSize()
  };

  return info;
};

/**
 * Get a public key by its fingerprint.
 * @param userId The user id of the key to get.
 * @returns {OpenPgpKey}
 */
Gpgkey.prototype.findPublic = function(userId) {
  for (var i in this.publicKeys) {
    if (this.publicKeys[i].user_id == userId) {
      return this.publicKeys[i];
    }
  }

  return null;
};

/**
 * Get a private key by its fingerprint.
 * @param userId The user id of the key to get.
 * @returns {OpenPgpKey}
 */
Gpgkey.prototype.findPrivate = function(userId) {
  // @todo For now support only one private by people.
  return this.privateKeys['MY_KEY_ID'];
};

/**
 * Generate a key pair from given parameters.
 * @param userId The user id of the key to get.
 * @param masterKey The master key.
 * @param lgth The length of the key
 * @returns {OpenPgpKey}
 */
Gpgkey.prototype.generateKeyPair = function(userId, masterKey, lgth) {
  var key = openpgp
    .generateKeyPair({
      numBits: lgth,
      userId: userId,
      passphrase:  masterKey
    });
  return key;
};

// Exports the Gpg Key object.
exports.Gpgkey = Gpgkey;