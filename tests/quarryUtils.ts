import { web3 } from "@project-serum/anchor";
import { expectTX } from "@saberhq/chai-solana";
import type { Provider } from "@saberhq/solana-contrib";
import { SignerWallet, SolanaProvider } from "@saberhq/solana-contrib";
import { mintNFT, Token, u64 } from "@saberhq/token-utils";
import type { Connection, PublicKey } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

import type { RewarderWrapper } from "../src";
import { QuarrySDK, QuarryWrapper } from "../src";
import { makeSDK } from "./workspace";

let stakeNonfungibleToken: Token;
let nonFungibleMint: Keypair;
let provider: Provider;
let sdk: QuarrySDK;
// let mintWrapper: MintWrapper;
// let mine: MineWrapper;

export const createRewarderAndQuarry = async ({
  connection,
  stakedToken,
  annualRate,
  adminKP = Keypair.generate(),
}: {
  adminKP?: Keypair;
  connection: Connection;
  /**
   * Token to stake in the Quarry.
   */
  stakedToken: Token;
  annualRate: u64;
}): Promise<{
  adminKP: Keypair;
  /**
   * Token issued as Quarry rewards.
   */
  rewardsToken: Token;

  quarry: PublicKey;
  /**
   * Quarry wrapper
   */
  quarryW: QuarryWrapper;

  rewarder: PublicKey;
  /**
   * Rewarder wrapper
   */
  rewarderW: RewarderWrapper;
}> => {
  const { rewardsToken, rewarder, rewarderW, quarrySDK } = await createRewarder(
    {
      connection,
      adminKP,
    }
  );

  sdk = makeSDK();
  // solana provider _rpcEndpoint: 'http://localhost:8899' etc...
  provider = sdk.provider;
  // specify the mintWrapper program to test/use
  // mintWrapper = sdk.mintWrapper;
  // // specify the mine program to test/use
  // mine = sdk.mine;

  nonFungibleMint = web3.Keypair.generate();
  const tx = await mintNFT(provider, nonFungibleMint);
  // Generate a new random keypair
  await tx.send();
  await tx.confirm();
  stakeNonfungibleToken = Token.fromMint(nonFungibleMint.publicKey, 0);
  const { tx: createQuarryTX, quarry: quarryKey } =
    await rewarderW.createQuarry({
      stakeNonfungibleToken,
    });
  await expectTX(createQuarryTX, "Create quarry").to.be.fulfilled;

  const quarryW = await QuarryWrapper.load({
    sdk: quarrySDK,
    token: nonFungibleMint.publicKey,
    key: quarryKey,
  });
  const setShareTX = quarryW.setRewardsShare(new u64(1));
  const syncRewardsTX = await rewarderW.setAndSyncAnnualRewards(annualRate, [
    stakedToken.mintAccount,
  ]);
  await expectTX(setShareTX.combine(syncRewardsTX), "set rewards").to.be
    .fulfilled;

  return {
    adminKP,
    rewardsToken,
    quarry: quarryKey,
    quarryW,
    rewarder,
    rewarderW,
  };
};

export const createRewarder = async ({
  connection,
  adminKP = Keypair.generate(),
}: {
  adminKP?: Keypair;
  connection: Connection;
}): Promise<{
  quarrySDK: QuarrySDK;
  adminKP: Keypair;
  /**
   * Token issued as Quarry rewards.
   */
  rewardsToken: Token;
  rewarder: PublicKey;
  rewarderW: RewarderWrapper;
}> => {
  await connection.confirmTransaction(
    await connection.requestAirdrop(adminKP.publicKey, 10 * LAMPORTS_PER_SOL)
  );

  const primaryQuarrySDK = QuarrySDK.load({
    provider: SolanaProvider.load({
      connection,
      sendConnection: connection,
      wallet: new SignerWallet(adminKP),
    }),
  });

  const primaryMintWrapper =
    await primaryQuarrySDK.mintWrapper.newWrapperAndMint({
      // 1B
      hardcap: new u64("1000000000000000"),
      decimals: 6,
    });
  await expectTX(primaryMintWrapper.tx, "primary mint wrapper").to.be.fulfilled;
  const primaryRewarder = await primaryQuarrySDK.mine.createRewarder({
    mintWrapper: primaryMintWrapper.mintWrapper,
  });
  await expectTX(primaryRewarder.tx, "primary rewarder").to.be.fulfilled;

  // create minter info
  const minterAddTX = await primaryQuarrySDK.mintWrapper.newMinterWithAllowance(
    primaryMintWrapper.mintWrapper,
    primaryRewarder.key,
    new u64(1_000_000000)
  );
  await expectTX(minterAddTX, "Minter add").to.be.fulfilled;

  // create quarry
  const rewarderW = await primaryQuarrySDK.mine.loadRewarderWrapper(
    primaryRewarder.key
  );

  return {
    quarrySDK: primaryQuarrySDK,
    adminKP,
    rewardsToken: Token.fromMint(primaryMintWrapper.mint, 6),
    rewarder: rewarderW.rewarderKey,
    rewarderW,
  };
};
