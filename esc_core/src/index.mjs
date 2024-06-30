/*
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { getBlockchainGateway } from '../blockchain_connect.mjs';

const dir = './esc/'
const paths = await readdir(dir);
const chaincodes = [];
const dataStorageContracts = [];
const calculationStorageContracts = [];

/**
 * Introduces the storage entities for each chaincode in the blockchain
 * @function
 * @param {array} chaincodes - The name of each chaincode to which create storage is contained in this array.
 * @param {array} dataStorageContracts - The names of the smart contracts that create each data storage for each chaincode.
 * @param {array} calculationStorageContracts - The names of the smart contracts that create each calculation storage for each chaincode.
 */
async function main(chaincodes, dataStorageContracts, calculationStorageContracts) {
  const gateway = await getBlockchainGateway(
    path.resolve(__dirname, '..', '..', 'network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json'),
    'admin'
  );

  // Get the network (channel) our contract is deployed to.
  const network = await gateway.getNetwork('escchannel');
  const chaincodesLength = chaincodes.length;

  for (let i = 0; i < chaincodesLength; i++) {
    const contract = network.getContract(chaincodes[i]);
    await contract.submitTransaction(dataStorageContracts[i]);
    await contract.submitTransaction(calculationStorageContracts[i]);
    console.log(`[elastic-smart-contracts] - Storage ${i + 1} of ${chaincodesLength} added`)
  }
}

console.log('[elastic-smart-contracts] - Parsed ESC modules:', paths);

for (const path of paths) {
  const module = await import(`../../${dir}/${path}`);
  chaincodes.push(module.config.chaincodeName);
  dataStorageContracts.push(module.config.dataStorageContract);
  calculationStorageContracts.push(module.config.calculationStorageContract);
}

await main(chaincodes, dataStorageContracts, calculationStorageContracts);
