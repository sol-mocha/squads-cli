import axios from "axios";
import SquadsSdk from "@sqds/sdk";
import * as anchor from "@project-serum/anchor";
import BN from "bn.js";
import { loadCliWallet } from "./wallet.js";
import { getProgramData, upgradeSetAuthorityIx } from "./program.js";

const API_ENDPOINT = "https://platoon-1.squads.so/api/";

const wallet = loadCliWallet();
const Squads = SquadsSdk.default;
const getTxPDA = SquadsSdk.getTxPDA;

const squads = Squads.mainnet(wallet);
const connection = new anchor.web3.Connection("https://api.mainnet-beta.solana.com");

export const getSquadExtended = async (ms) => {
    return squads.getMultisig(new anchor.web3.PublicKey(ms));
};

export const getSquads = async (pubkey) => {
    const response = await axios.get(`${API_ENDPOINT}members/${pubkey.toBase58()}`);
    const squadKeys = response.data.resp;
    return Promise.all(squadKeys.map(k => getSquadExtended(k)));
};

export const getTransactions = async (ms) => {
    const txIndex = ms.transactionIndex;
    const transactions = await Promise.all([...new Array(txIndex)].map(async (_, i) => {
        const [txPDA] = await getTxPDA(ms.publicKey, new BN(i+1), SquadsSdk.DEFAULT_MULTISIG_PROGRAM_ID);
        return squads.getTransaction(txPDA);
    }));
    return transactions;
}

export const createMultisig = async (threshold, createKey,members) => {
    const tx = await squads.createMultisig(threshold,createKey,members);
    return tx;
};

export const getProgramDataAuthority = async (programId) => {
    const program = await getProgramData(connection, programId);
    return program.info.authority;
};

export const createSafeAuthorityTx = async (msPDA, programId, currentAuthority, newAuthority) => {
    const nextTxIndex = squads.getNextTransactionIndex(msPDA);
    const [txPDA] = await getTxPDA(msPDA, nextTxIndex, SquadsSdk.DEFAULT_MULTISIG_PROGRAM_ID);
    const createTxIx = squads.buildCreateTransaction(msPDA, 1, nextTxIndex);
    const ix = await upgradeSetAuthorityIx(programId, currentAuthority, newAuthority);
    const addIx = squads.buildAddInstruction(msPDA, txPDA, ix, 1);
    const activateIx = squads.buildActivateTransaction();
    const approveIx = squads.buildApproveTransaction();

    const {blockhash, lastValidBlockHeight} = await connection.getLatestBlockhash();
    let tx = new anchor.web3.Transaction({blockhash, lastValidBlockHeight});
    tx.add(createTxIx);
    tx.add(addIx);
    tx.add(activateIx);
    tx.add(approveIx);
    tx.sign(wallet);
    const sig = connection.sendRawTransaction(tx.serialize(), {skipPreflight: true});
    await connection.confirmTransaction(sig);
    return sig;
};