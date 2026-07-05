package com.notanordinaryalarmclock.util

import kotlin.random.Random

data class MathProblem(val question: String, val answer: Int)

object MathChallenge {

    fun generate(): MathProblem {
        val a = Random.nextInt(4, 13)
        val b = Random.nextInt(4, 13)
        return when (listOf('+', '-', '*').random()) {
            '+' -> MathProblem("$a + $b", a + b)
            '-' -> {
                val hi = maxOf(a, b)
                val lo = minOf(a, b)
                MathProblem("$hi - $lo", hi - lo)
            }
            else -> MathProblem("$a × $b", a * b)
        }
    }
}
