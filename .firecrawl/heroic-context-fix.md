[Skip to last reply](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560/2) [Skip to top](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560/1)

[Skip to main content](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560#main-container)

# [What to do about “timeout: context canceled” in critical after-hook](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560)

[Runtime Framework](https://forum.heroiclabs.com/c/server-framework/29)

- [server-framework](https://forum.heroiclabs.com/tag/server-framework/5),
- [lua](https://forum.heroiclabs.com/tag/lua/30),
- [storage](https://forum.heroiclabs.com/tag/storage/31)

You have selected **0** posts.

[select all](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560)

[cancel selecting](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560)

[Apr 2022](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560/1 "Jump to the first post")

1 / 2


Apr 2022


[Apr 2022](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560/2)

## post by brianflakes on Apr 26, 2022

[![](https://sea2.discourse-cdn.com/flex020/user_avatar/forum.heroiclabs.com/brianflakes/48/1115_2.png)](https://forum.heroiclabs.com/u/brianflakes)

[brianflakes](https://forum.heroiclabs.com/u/brianflakes)

[Apr 2022](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560 "Post date")

We’ve found an error in production where critical code that sets up a user’s default metadata/wallet in the After hook for AuthenticateEmail/Apple/Custom produces the error “timeout: context canceled”.

I’ve read other posts ( [Error : "Context canceled" and "Context deadline exceed"](https://forum.heroiclabs.com/t/error-context-canceled-and-context-deadline-exceed/122) and [Error encountered context canceled while in goroutine](https://forum.heroiclabs.com/t/error-encountered-context-canceled-while-in-goroutine/1609)) explaining that if a client leaves before the request is complete, it will cancel database operations to reduce load. This makes sense if the work you’re doing has no side effects, but it’s dangerous otherwise. This behavior was a big surprise to our team.

Is there a way to disable this functionality or easily work around it in Lua?

1. Versions: Nakama 3.10 (forked from 1d0527e0), Docker, nakama-godot (77ecd966)
2. Server Framework Runtime language: Lua

1.5k
views
2
links


## post by mofirouz on Apr 30, 2022

[![](https://sea2.discourse-cdn.com/flex020/user_avatar/forum.heroiclabs.com/mofirouz/48/1523_2.png)](https://forum.heroiclabs.com/u/mofirouz)

[mofirouz](https://forum.heroiclabs.com/u/mofirouz)
Heroic Labs


[Apr 2022](https://forum.heroiclabs.com/t/what-to-do-about-timeout-context-canceled-in-critical-after-hook/2560/2 "Post date")

The context cancellation is working as expected. In this case, an option is converting (only) this Hook to Go code, and spin off a Goroutine with a background context to complete the work irrespectively of the original http request.

Please note that this can open you up to a DDOS attack if many many conn attempt to open and close connections very quickly.

The alternative is to make your storage writes:

a. Write all in one batch so that either everything is written or everything fails

b. Use conditional ‘\*’ version writes such that the write does not update the data that’s there in case of existing users coming back in.

Reply

### Related topics

| Topic |
| --- |
| [Error : “Context canceled” and “Context deadline exceed”](https://forum.heroiclabs.com/t/error-context-canceled-and-context-deadline-exceed/122)<br>[Local Setup](https://forum.heroiclabs.com/c/help/10) |  | [Local Setup](https://forum.heroiclabs.com/c/help/10) | 11 | ![](https://avatars.discourse-cdn.com/v4/letter/m/edb3f5/24.png) | May 2025 |
| [Lots of context canceled error after the server run a while](https://forum.heroiclabs.com/t/lots-of-context-canceled-error-after-the-server-run-a-while/5821)<br>[Runtime Framework](https://forum.heroiclabs.com/c/server-framework/29) <br>- [server-framework](https://forum.heroiclabs.com/tag/server-framework/5) |  | [Runtime Framework](https://forum.heroiclabs.com/c/server-framework/29) | 6 | ![](https://sea2.discourse-cdn.com/flex020/user_avatar/forum.heroiclabs.com/mengxin/24/1879_2.png) | Nov 2024 |
| [Error encountered context canceled while in goroutine](https://forum.heroiclabs.com/t/error-encountered-context-canceled-while-in-goroutine/1609)<br>[Local Setup](https://forum.heroiclabs.com/c/help/10) |  | [Local Setup](https://forum.heroiclabs.com/c/help/10) | 5 | ![](https://sea2.discourse-cdn.com/flex020/user_avatar/forum.heroiclabs.com/oshribin/24/349_2.png) | May 2021 |
| [Storage “context cancelled”](https://forum.heroiclabs.com/t/storage-context-cancelled/4015)<br>[Runtime Framework](https://forum.heroiclabs.com/c/server-framework/29) <br>- [server-framework](https://forum.heroiclabs.com/tag/server-framework/5) |  | [Runtime Framework](https://forum.heroiclabs.com/c/server-framework/29) | 2 | ![](https://sea2.discourse-cdn.com/flex020/user_avatar/forum.heroiclabs.com/lu-liyanghan/24/1755_2.png) | Jul 2023 |
| [How to increase time-out of default context for the StorageReadObjects method?](https://forum.heroiclabs.com/t/how-to-increase-time-out-of-default-context-for-the-storagereadobjects-method/892)<br>[Local Setup](https://forum.heroiclabs.com/c/help/10) |  | [Local Setup](https://forum.heroiclabs.com/c/help/10) | 2 | ![](https://avatars.discourse-cdn.com/v4/letter/a/eb9ed0/24.png) | Aug 2020 |

Topic list, column headers with buttons are sortable.

Invalid date

Invalid date