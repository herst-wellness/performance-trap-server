# -*- coding: utf-8 -*-
"""Rebuild the Mind/Body Foundations Acuity emails.

Three things changed under these emails and every one of them is now wrong in
the shipped copy:

  1. The journals are web pages, not Word files in a Dropbox folder, and they
     deliver themselves. Every "send me your journals by 48 hours before" is an
     instruction to do something that now happens on its own.
  2. Clients never see a file number again. "Open 03.00 Module 3 Roadmap" and
     "06.03C What You See In Me" name things that don't exist on the web.
  3. Readings and meditation audio are still in Dropbox, so the folder link
     stays. The emails now say plainly which thing lives where.

Also removed throughout, per docs/87 rule 4: every claim about how far along the
reader is. "By now you've probably read the first three chapters" tells a slower
reader they're behind, which is the pattern the program exists to interrupt.
"""
import html, os, re, sys

OUT = "/Users/chadherst/Library/CloudStorage/Dropbox/ML/Mind:Body Foundations/Email Templates 2026-09-14"
JOURNALS = "https://practice.herstwellness.com/practice/mbf"
ZOOM = "https://us02web.zoom.us/j/7706853577"
FOLDER = {
 1: "https://www.dropbox.com/scl/fo/PLACEHOLDER-MODULE-1",
 2: "https://www.dropbox.com/scl/fo/7bnik52g92xtd5ufg5jts/AJvJveuWMWqanMMH74W6aew?rlkey=dxxopkniyyapw80w1yj463ls1&dl=0",
 3: "https://www.dropbox.com/scl/fo/u3qr456o7pblrs0x0cnt9/ALuqott7mcQRN2CKEsxEdKM?rlkey=50sbvy4vri5ho7rozqdezbt4k&dl=0",
 4: "https://www.dropbox.com/scl/fo/3ob3ndzpvzyqm501dtbdv/ACSZNur_bory9NquR_oV4_c?rlkey=2yvxhqvvo5ke7dtxxjhtegj3z&dl=0",
 5: "https://www.dropbox.com/scl/fo/4nrz0aqbn9gp5h047g0l9/APrCu-SBfFliJAQOngpUUWg?rlkey=3c0a21b7b936m9yjv9lmaab71&dl=0",
 6: "https://www.dropbox.com/scl/fo/xc3wdpyh07jcoqkknkmln/ACG3y_qwxmq66HdK_eH-4To?rlkey=6ks6q70emjqhah2tzfg743kkd&dl=0",
 7: "https://www.dropbox.com/scl/fo/PLACEHOLDER-MODULE-7",
 8: "https://www.dropbox.com/scl/fo/PLACEHOLDER-MODULE-8",
}

SHELL = """<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBF7EF;font-family:'Lora',Georgia,'Times New Roman',serif;">
  <tr>
    <td align="center" style="padding:40px 20px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FBF7EF;">
        <tr>
          <td style="padding-bottom:14px;border-bottom:1px solid #C4A879;">
            <span style="font-family:'Lora',Georgia,serif;font-size:11px;color:#7C6C5C;letter-spacing:2.5px;text-transform:uppercase;">Herst Wellness</span>
          </td>
        </tr>
        <tr>
          <td style="font-family:'Lora',Georgia,serif;color:#4B4038;font-size:16px;line-height:1.65;padding:32px 0 0 0;">
%BODY%
            <p style="margin:0;font-style:italic;color:#6B5036;">Chad</p>
          </td>
        </tr>
        <tr>
          <td style="padding-top:32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-top:1px solid #C4A879;padding-top:14px;font-family:'Lora',Georgia,serif;line-height:1.55;">
                  <div style="color:#4B4038;font-size:13px;margin-bottom:2px;">Chad Herst</div>
                  <div style="color:#7C6C5C;font-size:12px;margin-bottom:8px;">Coach + author of <em>The Performance Trap</em></div>
                  <div style="color:#7C6C5C;font-size:12px;"><a href="https://herstwellness.com" style="color:#7C6C5C;text-decoration:none;">herstwellness.com</a> &nbsp;&middot;&nbsp; <a href="tel:14156864411" style="color:#7C6C5C;text-decoration:none;">415-686-4411</a></div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
"""

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: '<a href="%s" style="color:#7C6C5C;">%s</a>' % (m.group(2).replace('&','&amp;'), m.group(1)), s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', s)
    return s

def render(body):
    out = []
    for block in [b for b in body.strip().split("\n\n") if b.strip()]:
        lines = [l.strip() for l in block.strip().split("\n")]
        if lines[0].startswith("- "):
            items = "".join('<li style="margin:0 0 0.4em 0;">%s</li>' % inline(l[2:]) for l in lines)
            out.append('            <ul style="margin:0 0 1em 0;padding-left:1.5em;">%s</ul>' % items)
        else:
            out.append('            <p style="margin:0 0 1em 0;">%s</p>' % inline(" ".join(lines)))
    return SHELL.replace("%BODY%", "\n".join(out))

EMAILS = []
def email(module, n, filename, subject, body):
    body = body.replace("{ZOOM}", ZOOM).replace("{JOURNALS}", JOURNALS)
    for i in range(1, 9):
        body = body.replace("{FOLDER%d}" % i, FOLDER[i])
    EMAILS.append((module, n, filename, subject, body))

def where(n):
    return ("Everything for this module is in one place: [the reading, the meditations and the journals](%s). "
            "Bookmark that page. It doesn't change, each module turns up on it as we reach it, and your "
            "code is the one you've been using." % JOURNALS)

TIMING = ("There's nothing to send me. The journals come to me on their own as you write them, so all I ask is "
          "timing: finish the longer journals a couple of days before we meet, and the Session Prep the day "
          "before, so I've had time to sit with them.")

NOGUILT = "If you only get to some of it, come anyway and bring what you have. That has never once been a problem."

# ───────────────────────── Module 1 ─────────────────────────
email(1, 1, "01_welcome.html", "Module 1 is open", """
Hi %first%,

Glad we're doing this.

""" + where(1) + """

Three things to do today. Read the Welcome, download the Allos app for the breath practice, and start your daily ten to fifteen minutes.

Starting tomorrow you'll get a short text from me each morning asking yay or nay about your practice. Just data. No shame either way.

""" + TIMING + """

Our first session is %time%.

If anything's unclear or feels like too much, tell me. We narrow it together.

Looking forward to it.
""")

email(1, 2, "02_one_week_reminder.html", "A week out from our first session", """
Hi %first%,

About a week out from our session on %time%.

Quick check-in. How's the reading and the practice going?

If life's been full, here's the spine of Module 1: the Welcome, About You, Session Preparation, Turning Point and its journal, plus the daily practice. Those five and the sit will carry the session.

""" + NOGUILT + """

Reach out if anything's stuck.
""")

email(1, 3, "03_48hr_reminder.html", "We meet in two days", """
Hi %first%,

We meet %time%. Zoom link: [us02web.zoom.us/j/7706853577]({ZOOM})

Whatever's on your journal pages when I sit down with them is what I'll read, so there's nothing to send. If you weren't able to get to everything, bring what you have. We'll work with what's there.

See you soon.
""")

email(1, 4, "04_post_session.html", "After Module 1", """
Hi %first%,

Good session today.

The Follow-Up journal is on [your module page]({JOURNALS}). Do it in the next day or two, while what surfaced is still close. It's short.

Module 2 is open on the same page,. Start with the Welcome.

Daily yay or nay continues.

Our next session is %time%.
""")

# ───────────────────────── Module 2 ─────────────────────────
email(2, 1, "01_welcome.html", "Module 2 is open: awareness", """
Hi %first%,

We're moving into Module 2.

Module 1 ended on beginner's mind, which is setting down the lens you've been looking through your whole life. Which raises the obvious question: if you can set the lens down, what in you is doing the setting down? That's what this module is about.

""" + where(2) + """

This week, read the Welcome and Awareness, then read Aware and start the new daily meditation. Start with the fifteen-minute version.

The daily yay or nay text continues. The breath from Module 1 still counts, and the Aware sit builds on it.

""" + TIMING + """

Our next session is %time%.

Reach out if anything's unclear.
""")

email(2, 2, "02_one_week_reminder.html", "A week out from our Module 2 session", """
Hi %first%,

About a week out from our session on %time%.

Quick check-in. How are the reading, the journaling and the daily sit going?

If life's been full, here's the spine of Module 2: the Welcome, Awareness and its journal, The Kids on the Bus and its journal, plus the daily Aware sit.

""" + NOGUILT + """

Reach out if anything's stuck.
""")

email(2, 3, "03_48hr_reminder.html", "We meet in two days", """
Hi %first%,

We meet %time%. Zoom link: [us02web.zoom.us/j/7706853577]({ZOOM})

Nothing to send. Whatever's on your journal pages when I sit down with them is what I'll read. The Session Prep is the one I'd most like finished by tomorrow, since it's where I start our session from.

See you soon.
""")

email(2, 4, "04_post_session.html", "After Module 2", """
Hi %first%,

Good session today.

The Follow-Up journal is on [your module page]({JOURNALS}). Do it in the next day or two, while what surfaced is still close.

Module 3 is open on the same page,. Start with the Welcome.

Module 3 is the one where you find out that seeing a pattern and being able to stop it are two different things. That gap is the work.

Daily yay or nay continues.

Our next session is %time%.
""")

# ───────────────────────── Module 3 ─────────────────────────
email(3, 1, "01_welcome.html", "Module 3 is open: the loop underneath", """
Hi %first%,

We're moving into Module 3.

You can name the kids now. What usually turns up next is that you can see it and you still can't stop it. Something fires before the part climbs into the seat, and by the time you've noticed, it's already run. That isn't the work failing. It's where the work goes next.

""" + where(3) + """

This week, read the Welcome and Sankharas, then read Be With and the Be With practice, and start the new daily meditation. Start with the twenty-minute version.

The daily yay or nay continues. On a day when Be With is too much, the Aware sit or the breath still counts.

""" + TIMING + """

Our next session is %time%.

Reach out if anything's unclear.
""")

email(3, 2, "02_one_week_reminder.html", "A week out from our Module 3 session", """
Hi %first%,

About a week out from our session on %time%.

Quick check-in. How is the Be With practice landing?

I'll say the thing about this module plainly. Be With asks you to stay with what most of us are wired to override, and it's the hardest ask in the program so far. If it's bringing up resistance, that's information, not a problem. Bring it.

If life's been full, here's the spine of Module 3: the Welcome, Sankharas, The Formation of a Reaction, the Be With chapter and practice doc, plus the daily sit.

""" + NOGUILT + """

Reach out if anything's stuck.
""")

email(3, 3, "03_48hr_reminder.html", "We meet in two days", """
Hi %first%,

We meet %time%. Zoom link: [us02web.zoom.us/j/7706853577]({ZOOM})

Nothing to send. Whatever's on your journal pages when I sit down with them is what I'll read.

If you got into a loop you couldn't get under, or a place you couldn't stay with on your own, bring that one. That's the right use of the hour.

See you soon.
""")

email(3, 4, "04_post_session.html", "After Module 3", """
Hi %first%,

Good session today.

The Follow-Up journal is on [your module page]({JOURNALS}). Do it in the next day or two, while what surfaced is still close.

Module 4 is open on the same page,. Start with the Welcome.

Module 4 moves from staying with what's hard to riding it all the way through. The next letter of SENSE is equanimity.

Daily yay or nay continues.

Our next session is %time%.
""")

# ───────────────────────── Module 4 ─────────────────────────
email(4, 1, "01_welcome.html", "Module 4 is open: equanimity", """
Hi %first%,

We're moving into Module 4.

Module 3 taught you to stay with what fires in the body before the loop completes. Module 4 takes the same capacity further. You stay through the whole wave: past the rising, past the peak, into the falling, out the other side. That last part is where most of us bail, and it's also where the work changes you. The insight you couldn't have reasoned your way to arrives after the wave has passed, not in the middle of it.

""" + where(4) + """

This week, read the Welcome and The Law of Change. That chapter has one line worth carrying around for a day or two before you move on: believe the feelings, not the thoughts. Then read Surfing an Emotion and Equanimous, and start the new daily sit. There are two thirty-minute versions and they're different practices on the same capacity, not one meditation stretched. Alternate them.

One addition for this module. Try five to ten minutes before you fall asleep, on top of your main sit. Short and deliberate. It lets the day's charge move instead of coming to bed with you.

The Surfing Journal runs over three days, one story a day, and each one wants a night of sleep before the next. Don't compress it.

""" + TIMING + """

Our next session is %time%.

Reach out if anything's unclear.
""")

email(4, 2, "02_one_week_reminder.html", "A week out from our Module 4 session", """
Hi %first%,

About a week out from our session on %time%.

Quick check-in. How's the Equanimous sit landing?

The moment this module turns on is the one where the part of you that wants out gets loud. The peak. The instruction is the practice: stay one breath longer than is comfortable, then the next one, then the next. The wave passes when you don't get off the board.

If life's been full, here's the spine of Module 4: the Welcome, The Law of Change, Surfing an Emotion, the Equanimous practice doc, the daily sit, and at least one of the three Surfing Journal stories.

If you haven't read The Whole Arc in One Session yet, it's worth an unhurried hour. It walks one client's session end to end and it makes the chapters land as one thing.

""" + NOGUILT + """

Reach out if anything's stuck.
""")

email(4, 3, "03_48hr_reminder.html", "We meet in two days", """
Hi %first%,

We meet %time%. Zoom link: [us02web.zoom.us/j/7706853577]({ZOOM})

Nothing to send. Whatever's on your journal pages when I sit down with them is what I'll read, and if you only got to one or two of the three stories, that's what we'll work with.

If a wave came up in the writing and you couldn't stay through to the other side, bring that one. This is the module where we surf the one you couldn't surf alone.

See you soon.
""")

email(4, 4, "04_post_session.html", "After Module 4", """
Hi %first%,

Good session today.

The Follow-Up journal is on [your module page]({JOURNALS}), and there's a prompt in it about the wave you rode and what arrived on the other side. The hours right after a session are when the body is closest to remembering. Use them.

Module 5 is open on the same page,.

Module 5 closes the inner half. Module 4 built the capacity to stay through the wave. Module 5 adds the heart side: meeting what's underneath it, the parts you left behind to belong, with the kindness they never got when they formed. This is the homecoming the work has been moving toward since Module 1.

Daily yay or nay continues. The Equanimous sit carries on alongside the new practice.

Our next session is %time%.
""")

# ───────────────────────── Module 5 ─────────────────────────
email(5, 1, "01_welcome.html", "Module 5 is open: the protector and the wound", """
Hi %first%,

We're moving into Module 5, and this one closes the inner half of the program.

Module 4 taught equanimity as a capacity, the ability to stay through the wave to the other side. Module 5 turns the same capacity toward what's underneath the wave, with kindness. The wound the protector has been guarding finally gets met by the one thing it's been waiting for, which isn't fixing. It's company.

""" + where(5) + """

This week, read the Welcome and The Protector and the Wound, and sit with which protector you recognize as yours before moving on. Then read The Sacred Wound and Compassion, and start the new daily sit. Two thirty-minute versions, same as last module, distinct practices rather than one stretched. Alternate them.

A word on pacing, and it matters more here than anywhere. This module asks you to turn toward material a protector has spent decades keeping out of view. Go slowly. If anything gets too big, back off, go to the breath, come back later. The titration you trained in Modules 3 and 4 is exactly for this.

The Protector and Wound journal runs over three days, one section a day, and each wants a night of sleep before the next.

""" + TIMING + """

Our next session is %time%.

Reach out if anything's unclear, or if what's surfacing is bigger than you want to sit with alone.
""")

email(5, 2, "02_one_week_reminder.html", "A week out from our Module 5 session", """
Hi %first%,

About a week out from our session on %time%.

Quick check-in. In terms of what surfaces, this is the heaviest module in the program.

One thing to expect. If the protector you named has got louder this week, that's the protector doing its job. You're turning toward the thing it's been guarding, and it doesn't know yet that you're not a threat.

If life's been full, here's the spine of Module 5: the Welcome, the four chapters, the Compassion practice doc, the daily sit, and at least one section of the three-part journal.

And if something's getting too big to sit with alone, reach out. That's part of the work rather than a failure of it. The Coming Home chapter calls asking for help overt self-compassion. Don't wait for our session if something wants company sooner.

""" + NOGUILT + """
""")

email(5, 3, "03_48hr_reminder.html", "We meet in two days", """
Hi %first%,

We meet %time%. Zoom link: [us02web.zoom.us/j/7706853577]({ZOOM})

Nothing to send. Whatever's on your journal pages when I sit down with them is what I'll read, and if you got to one section of the three, that's what we'll work with.

If a protector or a wound surfaced and you couldn't quite meet it on your own, bring that one. These sessions are often exactly that.

See you soon.
""")

email(5, 4, "04_post_session.html", "After Module 5", """
Hi %first%,

Good session today.

The Follow-Up journal is on [your module page]({JOURNALS}). Do it in the next day or two. These sessions tend to land tender, and whatever opened today will be closer to the surface now than later in the week.

Module 6 is open on the same page,. Open it sooner rather than later. There's a piece in it that needs other people's time, not just yours.

You've completed the inner half. Modules 1 through 5 built SENSE, the capacity to come back to yourself in the body, all the way through to the parts that needed kindness. Module 6 turns it outward into STEP, with two new letters: still, the moment you stop and don't automatically do the old thing, and tune in to the trade, the contract made conscious enough to look at. Now that you've come back to the one who signed it, you have standing to read it.

Daily yay or nay continues. The Compassion sit carries on.

Our next session is %time%.
""")

# ───────────────────────── Module 6 ─────────────────────────
email(6, 1, "01_welcome.html", "Module 6 is open, and one piece needs starting today", """
Hi %first%,

We're into the final stretch, and this phase is different. It isn't about efforting toward a better version of yourself. It's about listening more closely to what's already true.

Everything so far has been building one capacity: the ability to pause. When you can pause, you stop living from reaction and start making choices that feel like yours. Not perfect. Honest.

""" + where(6) + """

Module 6 is shaped differently from the others, and there's one thing I need you to start today.

The module is built around a document you'll get from me after our session: five heartfelt intentions and three life purpose statements, written from material you send me and from what three of your friends send me. Most people tell me this module is the high point of the program, and the reason it lands is that document. It only works if we have the friends' reflections to work with.

So today, read the Life Purpose chapter, then open Reaching Out and choose three people who know you well. It walks you through who to ask, how to ask, and how to run the conversation. Send each of them the What You See In Me form as soon as they say yes, get a call in the calendar with each one over the next two weeks, and take notes.

One note on who to ask. Steer away from parents and grandparents. They tend to see who we've been rather than who we are now. Choose people who've seen you in motion in the last few years.

This part needs wall-clock time. Friends have to reply, calls have to be scheduled, conversations have to happen. If it waits a week it won't fit, and if the notes arrive late we'll have to move our session.

Alongside that: read the Welcome, Heartfelt Intentions and Tune in to the Trade. Work through Natural Strengths, your own picker and deep dive on three qualities. It is the half of this that comes from you rather than from your friends. And start the new daily Gratitude-Choice-Commitment sit. Compassion steps back and GCC becomes the daily.

""" + TIMING + """ Your friends' forms and your interview notes come to me by email, since those aren't journal pages.

Our next session is %time%. Please block two full hours. This is deep work and I don't want to rush it.

Reach out if anything's unclear, or if the friend ask feels harder than expected. That part is supposed to stretch you a little.
""")

email(6, 2, "02_one_week_reminder.html", "A week out from our Module 6 session", """
Hi %first%,

About a week out from our session on %time%.

The friend interviews first, since they're the part with a deadline outside your control. If the ask hasn't gone out, send it today. The conversations need to happen this week.

If the asking is hard, here's the thing to hold. Your life purpose isn't something you have to invent. It's already moving through your life, in how you show up for people and in what they keep coming to you for. The interviews aren't about producing something new. They're about naming what's already there.

Then Natural Strengths, the three qualities you name for yourself. It sits alongside what your friends send and the two get woven together after our session.

If life is full, prioritize these: the interviews sent and scheduled, Natural Strengths, and the daily GCC sit. Everything else can wait.

A small thing to try this week alongside the sit. At the end of each day, note four answers. Who or what inspired me today. What made me happy. Where did I find peace. How did I use the gift of my life today. A sentence each is plenty. They prime the noticing for our session.

Reach out if anything's stuck, the friend ask especially. If it's harder than you expected, tell me and we'll talk it through.
""")

email(6, 3, "03_48hr_reminder.html", "We meet in two days", """
Hi %first%,

We meet %time%. Zoom link: [us02web.zoom.us/j/7706853577]({ZOOM})

Your journals come to me on their own. The two things that don't are your three friends' completed forms and your notes from the three conversations. Those I need by email, today if you haven't sent them.

If a friend is still in progress, send what you have. We'll work with what's there.

See you soon.
""")

email(6, 4, "04_post_session.html", "After Module 6", """
Hi %first%,

Good session. Thank you for the work you brought, and for the courage of asking three people to reflect back what they see in you. That isn't a small ask and you did it.

Two things from here.

Your Heartfelt Intentions and Life Purpose document is in progress. I'm taking everything you and your three friends sent and weaving it into one document: your intentions, your purpose statements, and the evidence behind each one. It takes me a week or two. You'll get it as its own email.

Meanwhile the Follow-Up journal is on [your module page]({JOURNALS}). It's longer than the usual one, so take it slowly and start with the intention that feels most alive. It asks where you're honoring each intention and where you're trading it away, which is tune in to the trade in its fullest form.

Module 7 is open on the same page,. It picks up with what to do once you've tuned in.

Keep the daily GCC sit and the bedtime sit going. Daily yay or nay continues.

Our next session is %time%.
""")

email(6, 5, "05_document_delivery.html", "Your Heartfelt Intentions and Life Purpose", """
Hi %first%,

Here it is. Your Heartfelt Intentions and Life Purpose document, attached.

This is the artifact of our Module 6 work. Your intentions, your purpose statements, and the evidence behind each one, in the words of the three friends who reflected you back. It doesn't give you anything new. It hands back what you've been carrying, in language you can recognize.

A few suggestions for using it.

- Read it slowly. Sit with each section. Notice what lands in your body and what makes you flinch. Both are information.
- Print it. Keep it where you'll see it. On your desk, in your journal, near where you sit. A document on a screen disappears.
- Come back to it. When you're caught in a decision, when the throat clamps, when a trade is forming, pull it out.
- Let it work on you. Some sentences will feel true straight away. Others take months. It's meant to age into accuracy.

People tell me years later that this is the thing they still go back to. Keep it somewhere safe.

If you're still working through the Follow-Up journal, this document gives you everything you need for the intention and purpose fields. The two go together.
""")

# ───────────────────────── Module 7 ─────────────────────────
email(7, 1, "01_welcome.html", "Module 7 is open: the third option", """
Hi %first%,

We're moving into Module 7. This is where the inner work starts to become behavior. The seeing, the staying, the compassion, the naming, all of it has been preparation. Module 7 is where you do something different in real life.

The teaching at the heart of it is the third option. Under stress the nervous system collapses the world into a false pair. Either I tell the truth and ruin the relationship, or I stay quiet and abandon myself. Either I answer now and exhaust myself, or I say no and I'm selfish. The pair is almost never the truth. There's nearly always a third move the bind told you wasn't available, and this module asks you to start making it.

""" + where(7) + """

This week, read the Welcome and The Third Option. That one is the framework piece and it's worth reading slowly. Five client stories in it show what the third option looked like in five different lives. Then read Conscious Choice and start the new daily sit. GCC carries over as the alternative sit.

Then pick one either-or in your own life and work it through Stop-Look-Go.

In the second week, read Expand Options and Practice, and do their journals. The Practice journal asks you to name one honest sentence you've been postponing, and then to take the small move. If you only do one thing in this module, take the move.

""" + TIMING + """

Our next session is %time%.

Reach out if anything's unclear, or if the move you've named is harder to take than you expected. That's usually where the real work shows up.
""")

email(7, 2, "02_one_week_reminder.html", "A week out from our Module 7 session", """
Hi %first%,

About a week out from our session on %time%.

What this module asks for is the muscle of choice. Not in theory. In real life. The third option, the small honest move, the moment your body learns it can survive telling the truth.

One thing worth flagging. The first time you take a practice move it rarely feels graceful. It usually feels awkward, exposed, half-done. That's the normal shape of it, because the body learns from the awkward attempt rather than the polished one. If you've taken a move and it didn't go the way you pictured, bring that. The recovery is also the practice.

If life is full, here's the spine of Module 7: The Third Option, one round of Stop-Look-Go on one either-or, the daily Conscious Choice sit, and the Practice journal. Even if you don't take the move this week, naming the sentence is the practice.

Reach out if anything's stuck. The honest sentence especially. If you've named it and you can't imagine saying it out loud, tell me. That conversation is often where this module lands hardest.
""")

email(7, 3, "03_48hr_reminder.html", "We meet in two days", """
Hi %first%,

We meet %time%. Zoom link: [us02web.zoom.us/j/7706853577]({ZOOM})

Nothing to send. Whatever's on your journal pages when I sit down with them is what I'll read, and if you got to one of the three, that's what we'll work with.

If you've taken a move in the last couple of weeks, the honest sentence, the little no, the boundary, bring it. If you haven't, bring that. The not-yet is often where the work needs to go.

See you soon.
""")

email(7, 4, "04_post_session.html", "After Module 7", """
Hi %first%,

Good work today. The third option doesn't show up the same way twice. Whatever shape it took between us, what matters now is the small move that follows.

The Follow-Up journal is on [your module page]({JOURNALS}). Do it in the next day or two. It walks you through naming the bind more clearly, sensing where the third option lives in you now, and the one step you'll take this week. Don't try to do it in a single sitting. The prompts are spacious.

Module 8 is open on the same page,. It's the integration module, where this stops being a set of techniques and becomes a way of living.

Keep the Conscious Choice sit and the bedtime sit going. Daily yay or nay continues.

Our next session is %time%.
""")

# ───────────────────────── Module 8 ─────────────────────────
email(8, 1, "01_welcome.html", "Module 8, the last one", """
Hi %first%,

We're entering Module 8, and it's different from the seven before it. Less new teaching, more reflection. The work is to let what we've been doing land in you as a different relationship with yourself, rather than a set of tools you happen to know.

Four questions organize it, and each one gets a chapter and a journal. What have I learned about myself. What am I no longer willing to carry. Who will help me remember. What wants to happen now.

""" + where(8) + """

This week, read the Welcome, then read Loving-Kindness and start the new daily sit. Sixteen minutes. 

Then read Your Heroine/Hero's Journey and listen to the audio that goes with it. The chapter walks Campbell's monomyth through the Buddha's story. The audio walks it through your own arc across this program, module by module. Then begin the Hero's Journey journal. Plan on two or three sittings. It's the most important thing in Module 8.

In the second week, read Protecting Your Sapling, A New Invitation and Be The Change, and do Your Road Back and the two New Invitation journals, the first before your conversations and the second after. Then read Crossing the Threshold, the closing ritual you do alone the day before our final session or the morning of it.

""" + TIMING + """

Our next session is %time%. The last one in this program.

Take it slow. There's no prize for finishing the homework. The point is to let this land.
""")

email(8, 2, "02_one_week_reminder.html", "A week out from our final session", """
Hi %first%,

About a week out from our final session on %time%.

The Hero's Journey journal is the centerpiece of this module. If it hasn't started, this is the week for it, and plan on two or three sittings rather than one.

The other big one is Your Road Back. A check-in across seven areas of your life, then deeper work on the two or three that matter most right now. The instruction to do less rather than more is deliberate. Two or three commitments you can actually live into will move your life further than seven you can't.

A note about next week. A New Invitation asks you to choose three people and have a particular kind of conversation with each, inviting them to know who you've become and to help you keep becoming it. Most people find it uncomfortable to imagine and meaningful to do. If you can name the three people now, the conversations will be easier to get in the calendar.

If life is full, here's the spine of Module 8: the Hero's Journey chapter and journal, the check-in section of Your Road Back, the Crossing the Threshold ritual, and the Session Prep.

Reach out if you're stuck on any of it, the Hero's Journey especially. If a prompt is hard, that usually means it's working.
""")

email(8, 3, "03_48hr_reminder.html", "Two days to our final session", """
Hi %first%,

Our final session is %time%. Zoom link: [us02web.zoom.us/j/7706853577]({ZOOM})

Nothing to send, and if you only got to some of it, that's what we'll work with.

One thing I'd ask you not to skip. The Session Prep for our last session has a question in it about what scares you about what comes after this. That's the one I most want to talk through.

And if you haven't done Crossing the Threshold, plan it for tomorrow or the morning of our session. Thirty minutes, alone. The two objects, the candle, the vow. Trust the ritual even if some part of you finds it earnest. The body learns from what we enact, not only from what we understand.

See you soon.
""")

email(8, 4, "04_post_session.html", "After Mind/Body Foundations", """
Hi %first%,

The structured program is closed. The work isn't. It's changed shape. The breath, the awareness, the surfing, the staying with what's underneath, the kindness toward the parts you'd been rejecting: those go on working in you whether or not anyone reminds you.

No homework this time.

A couple of housekeeping things, then the actual reason for this email.

Your page stays yours, all eight modules of it. Come back to any of it whenever you want. The chapters you skim now hit differently in a year.

I'll check in at one month and at three months. Short emails, no pressure to write back. If you want a session at either point, the door is wide open.

On continuing, when you're ready. Most people come back at some point, sometimes for one session when something specific comes up, sometimes for a longer arc when it's time for the next body of work. The next arc isn't a repeat of this one. It has its own shape. If something arises that wants company, send me a few sentences and we'll figure it out.

Two requests, and these are the real reason I'm writing.

One, a referral, if someone comes to mind. My business runs almost entirely on word of mouth, and there's a good chance you found me that way yourself. I don't run ads. I tell my stories, put the work out there, and trust that the right people get sent my way by the people who already trust it. If a particular person comes to mind as you read this, send them along. I honor a price close to yours when it's appropriate.

Two, a review on [Yelp](https://www.yelp.com/biz/herst-wellness-san-francisco) or [Google](https://www.google.com/search?q=Herst+Wellness), if you're willing. Reviews are how people find me when nobody has introduced us. If what we did felt useful, a few honest sentences would help this reach people who haven't been told about it. Short is fine. Honest is what matters.

Thank you, again, for the work you did and for what you let me see of you doing it.

Let's not be strangers.
""")

# ───────────────────────── write ─────────────────────────
os.makedirs(OUT, exist_ok=True)
index = ["# Mind/Body Foundations: the module emails, rebuilt 2026-09-14",
         "",
         "Paste the subject into Acuity's subject field and the HTML into the body in",
         "source mode. `%first%` and `%time%` are preserved.",
         "",
         "| Module | Email | Subject |", "|---|---|---|"]
for module, n, filename, subject, body in EMAILS:
    d = os.path.join(OUT, "Module %d" % module)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, filename), "w", encoding="utf-8").write(render(body))
    index.append("| %d | %s | %s |" % (module, filename.replace(".html", ""), subject))
open(os.path.join(OUT, "README - subjects and what changed.md"), "w", encoding="utf-8").write("\n".join(index) + "\n")
print("wrote %d emails to %s" % (len(EMAILS), OUT))
