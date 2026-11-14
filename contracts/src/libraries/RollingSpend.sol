// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @dev Exact rolling window with a bounded 256-entry ring; no daily buckets or unbounded loops.
library RollingSpend {
    uint256 internal constant WINDOW = 24 hours;
    uint256 internal constant CAPACITY = 256;

    struct Entry {
        uint64 timestamp;
        uint192 valueUsd;
    }

    struct History {
        Entry[256] entries;
        uint16 head;
        uint16 count;
        uint256 total;
    }

    function spent(History storage self) internal view returns (uint256 total) {
        total = self.total;
        for (uint256 i; i < self.count; ++i) {
            Entry storage entry = self.entries[(uint256(self.head) + i) % CAPACITY];
            if (uint256(entry.timestamp) + WINDOW > block.timestamp) break;
            total -= entry.valueUsd;
        }
    }

    function prune(History storage self) internal {
        while (self.count != 0) {
            Entry storage entry = self.entries[self.head];
            if (uint256(entry.timestamp) + WINDOW > block.timestamp) break;
            self.total -= entry.valueUsd;
            delete self.entries[self.head];
            self.head = uint16((uint256(self.head) + 1) % CAPACITY);
            --self.count;
        }
    }

    function record(History storage self, uint192 valueUsd) internal returns (bool) {
        prune(self);
        if (self.count == CAPACITY) return false;
        uint256 tail = (uint256(self.head) + self.count) % CAPACITY;
        self.entries[tail] = Entry(uint64(block.timestamp), valueUsd);
        self.total += valueUsd;
        ++self.count;
        return true;
    }
}
