declare module "@summa-tx/bitcoin-spv-js" {
  interface Header {
    raw: Uint8Array;
    hash: Uint8Array;
    height: Number;
    merkle_root: Uint8Array;
    prevhash: Uint8Array;
  }
  interface Proof {
    version: Uint8Array;
    vin: Uint8Array;
    vout: Uint8Array;
    locktime: Uint8Array;
    tx_id: Uint8Array;
    index: Number;
    intermediate_nodes: Uint8Array;
    confirming_header: Header;
  }
  export const ser: {
    /**
     *
     * Deserializes a SPVProof object from a JSON string
     *
     * @param {string}    s The SPVProof serialized as a JSON string
     * @returns {Proof}    The SPVProof with deserialized byte arrays
     */
    deserializeSPVProof(s: string): Proof;
  };
  export const ValidateSPV: {
    /**
     *
     * Checks validity of an entire SPV Proof
     *
     * @dev                   Checks that each element in an SPV Proof is valid
     * @param {Proof}         proof A valid SPV Proof object, see README for
     *                          more information on creating an SPV Proof object
     * @returns {Boolean}     Returns true if the SPV Proof object is syntactically valid
     * @throws {Error}        If any of the SPV Proof elements are invalid
     */
    validateProof(proof: Proof): boolean;
  };
}
