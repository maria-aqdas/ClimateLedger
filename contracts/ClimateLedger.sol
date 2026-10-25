// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Anchors SHA-256 hashes of verified climate reports on-chain.
/// `eligible` records whether the parametric trigger passed (insurance / climate-fund payout eligibility).
contract ClimateLedger {
    struct Record { uint256 time; address reporter; bool eligible; }
    mapping(bytes32 => Record) public records;
    event Anchored(bytes32 indexed hash, address indexed reporter, bool eligible, uint256 time);

    function anchor(bytes32 h, bool eligible) external {
        require(records[h].time == 0, "already anchored");
        records[h] = Record(block.timestamp, msg.sender, eligible);
        emit Anchored(h, msg.sender, eligible, block.timestamp);
    }

    function verify(bytes32 h) external view returns (bool found, uint256 time, bool eligible) {
        Record memory r = records[h];
        return (r.time != 0, r.time, r.eligible);
    }
}
