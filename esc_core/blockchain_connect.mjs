import { Gateway, Wallets } from 'fabric-network';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
/**
 * Connects to the blockchain network
 * @function
 */
export async function getBlockchainGateway(ccpPath, identityName) {
  try {
    // load the network configuration
    const ccp = JSON.parse(await readFile(ccpPath, 'utf8'));
    console.log(`[elastic-smart-contracts] - ccpPath path: ${ccpPath}`)

    // Create a new file system based wallet for managing identities.
    const walletPath = path.join(process.cwd() + '/esc_core/wallet');
    const wallet = await Wallets.newFileSystemWallet(walletPath);
    console.log(`[elastic-smart-contracts] - Wallet path: ${walletPath}`);

    // Check to see if we've already enrolled the user.
    const identity = await wallet.get(identityName);
    if (!identity) {
      console.log(`[elastic-smart-contracts] - An identity for the user "${identityName}" does not exist in the wallet`, 'Run the registerUser.js application before retrying');
      return;
    }

    // Create a new gateway for connecting to our peer node.
    const gateway = new Gateway();
    await gateway.connect(ccp, { wallet, identity, discovery: { enabled: true, asLocalhost: true } });

    return gateway;
  } catch (error) {
    console.error(`Failed to submit transaction: ${error}`);
  }
}
